import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test("server-issued QR tokens gate face verification and attendance", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attendance-qr-api-"));
  const port = await freePort();
  const faceToken = "test-only-face-service-token-32-bytes";
  let blinkPass = true;
  const faceServer = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const payload = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/verify") {
      assert.equal(req.headers.authorization, `Bearer ${faceToken}`);
      res.end(JSON.stringify({ verified: true, blinkVerified: blinkPass, studentId: payload.studentId }));
    }
    else res.end(JSON.stringify({ enrolled: true }));
  });
  await new Promise((resolve) => faceServer.listen(0, "127.0.0.1", resolve));
  let child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir, QR_TTL_SECONDS: "10", CORS_ORIGINS: "http://trusted.test", FACE_SERVICE_URL: `http://127.0.0.1:${faceServer.address().port}`, FACE_SERVICE_TOKEN: faceToken },
    stdio: "ignore",
  });
  t.after(async () => {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    faceServer.close();
    faceServer.closeAllConnections?.();
    await rm(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) assert.fail(`API exited with code ${child.exitCode}`);
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* wait for listen */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "API did not start");
  const trustedCors = await fetch(`${base}/api/health`, { headers: { Origin: "http://trusted.test" } });
  assert.equal(trustedCors.headers.get("access-control-allow-origin"), "http://trusted.test");
  const rejectedCors = await fetch(`${base}/api/health`, { headers: { Origin: "http://untrusted.test" } });
  assert.equal(rejectedCors.headers.get("access-control-allow-origin"), null);

  async function post(url, body, token) {
    const response = await fetch(`${base}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { response, payload: await response.json() };
  }
  const professor = await post("/api/auth/login", { loginId: "T001", password: "teacher123" });
  assert.equal(professor.response.status, 200);
  const createdCourse = await post("/api/teacher/courses", {
    name: "QR Flow Test", code: "QRTEST", days: ["Monday"], startTime: "16:00", endTime: "17:00", beaconId: "Room Test", studentIds: ["23BCS001"],
  }, professor.payload.token);
  assert.equal(createdCourse.response.status, 201);
  const session = await post("/api/sessions", { courseId: createdCourse.payload.course.id }, professor.payload.token);
  assert.equal(session.response.status, 201);
  const sessionCode = session.payload.code;
  const qrResponse = await fetch(`${base}/api/sessions/${sessionCode}/qr`, { headers: { Authorization: `Bearer ${professor.payload.token}` } });
  const qr = await qrResponse.json();
  assert.equal(qrResponse.status, 200);
  assert.equal(qr.ttlSeconds, 10);
  assert.match(qr.token, /^[a-f0-9]{48}$/);
  const duplicateDisplay = await fetch(`${base}/api/sessions/${sessionCode}/qr`, { headers: { Authorization: `Bearer ${professor.payload.token}` } });
  assert.equal((await duplicateDisplay.json()).token, qr.token, "all students can use the same current session QR");

  const student = await post("/api/auth/login", { loginId: "23BCS001", password: "student123" });
  const unauthorizedStudent = await post("/api/auth/login", { loginId: "23BCS002", password: "student123" });
  const attempt = await post("/api/attendance/attempts", { courseId: createdCourse.payload.course.id }, student.payload.token);
  assert.equal(attempt.response.status, 201);
  assert.deepEqual(attempt.payload.requiredFactors, ["qr", "face"]);
  const unauthorizedAttempt = await post("/api/attendance/attempts", { courseId: createdCourse.payload.course.id }, unauthorizedStudent.payload.token);
  assert.equal(unauthorizedAttempt.response.status, 409);

  const image = "data:image/jpeg;base64,dGVzdA==";
  const faceBeforeQr = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/face`, { image }, student.payload.token);
  assert.equal(faceBeforeQr.response.status, 409);
  assert.equal(faceBeforeQr.payload.error.code, "QR_REQUIRED");
  const malformed = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/qr`, { sessionId: sessionCode, token: "bad" }, student.payload.token);
  assert.equal(malformed.response.status, 400);
  const wrongSession = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/qr`, { sessionId: "OTHER", token: qr.token }, student.payload.token);
  assert.equal(wrongSession.response.status, 400);
  const accepted = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/qr`, { sessionId: qr.sessionId, token: qr.token }, student.payload.token);
  assert.equal(accepted.response.status, 200);
  const beforeFace = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/complete`, {}, student.payload.token);
  assert.equal(beforeFace.response.status, 409);
  assert.equal(beforeFace.payload.error.code, "FACTORS_INCOMPLETE");
  const beforeFaceDb = new DatabaseSync(path.join(dataDir, "attendance.sqlite"), { readOnly: true });
  assert.equal(beforeFaceDb.prepare("SELECT COUNT(*) AS count FROM attendance_records").get().count, 0, "failed/incomplete verification must not persist attendance");
  beforeFaceDb.close();

  const expiringAttempt = await post("/api/attendance/attempts", { courseId: createdCourse.payload.course.id }, student.payload.token);
  assert.equal(expiringAttempt.response.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 10_200));
  const expired = await post(`/api/attendance/attempts/${expiringAttempt.payload.attemptId}/qr`, { sessionId: qr.sessionId, token: qr.token }, student.payload.token);
  assert.equal(expired.response.status, 400);
  assert.equal(expired.payload.error.code, "QR_INVALID");

  const challenge = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/face/challenge`, {}, student.payload.token);
  assert.equal(challenge.response.status, 200);
  const frames = Array.from({ length: 10 }, () => image);
  blinkPass = false;
  const failedFace = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/face`, { challengeId: challenge.payload.challengeId, frames }, student.payload.token);
  assert.equal(failedFace.response.status, 403);
  assert.equal(failedFace.payload.error.code, "BLINK_NOT_DETECTED");
  const afterFailedFaceDb = new DatabaseSync(path.join(dataDir, "attendance.sqlite"), { readOnly: true });
  assert.equal(afterFailedFaceDb.prepare("SELECT COUNT(*) AS count FROM attendance_records").get().count, 0, "a failed blink check must not persist attendance");
  afterFailedFaceDb.close();

  const retryChallenge = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/face/challenge`, {}, student.payload.token);
  blinkPass = true;
  const face = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/face`, { challengeId: retryChallenge.payload.challengeId, frames }, student.payload.token);
  assert.equal(face.response.status, 200);
  assert.equal(face.payload.verified, true);
  const completed = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/complete`, {}, student.payload.token);
  assert.equal(completed.response.status, 200);
  assert.equal(completed.payload.status, "present");
  assert.deepEqual(completed.payload.verifiedSteps, ["qr", "blink", "face"]);
  const duplicateCompletion = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/complete`, {}, student.payload.token);
  assert.equal(duplicateCompletion.response.status, 409);
  const database = new DatabaseSync(path.join(dataDir, "attendance.sqlite"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE student_id=? AND session_id=?").get("23BCS001", sessionCode).count, 1);
  const duplicateRow = database.prepare("INSERT OR IGNORE INTO attendance_records(student_id,course_id,session_id,marked_at,date,status,verified_steps_json) VALUES(?,?,?,?,?,?,?)")
    .run("23BCS001", createdCourse.payload.course.id, sessionCode, completed.payload.markedAt, completed.payload.date, "present", '["qr","face"]');
  assert.equal(duplicateRow.changes, 0, "the database unique constraint must reject a duplicate even at the SQL layer");
  database.close();

  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir, QR_TTL_SECONDS: "10", CORS_ORIGINS: "http://trusted.test", FACE_SERVICE_URL: `http://127.0.0.1:${faceServer.address().port}`, FACE_SERVICE_TOKEN: faceToken },
    stdio: "ignore",
  });
  ready = false;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) assert.fail(`API restart exited with code ${child.exitCode}`);
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* wait for restart */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "API should restart against the same SQLite file");
  const persistedAttendance = await fetch(`${base}/api/sessions/${sessionCode}/attendance`, { headers: { Authorization: `Bearer ${professor.payload.token}` } });
  const persistedRoster = await persistedAttendance.json();
  assert.equal(persistedRoster.roster[0].present, true, "attendance should survive an API restart");
  assert.equal(persistedRoster.roster[0].markedAt, completed.payload.markedAt);

  const close = await post(`/api/sessions/${sessionCode}/close`, {}, professor.payload.token);
  assert.equal(close.response.status, 200);
  const inactive = await post(`/api/attendance/attempts/${attempt.payload.attemptId}/qr`, { sessionId: qr.sessionId, token: qr.token }, student.payload.token);
  assert.equal(inactive.response.status, 409);
  assert.equal(inactive.payload.error.code, "SESSION_CLOSED");
  const attendance = await fetch(`${base}/api/sessions/${sessionCode}/attendance`, { headers: { Authorization: `Bearer ${professor.payload.token}` } });
  const roster = await attendance.json();
  assert.equal(roster.roster[0].present, true, "recorded attendance remains present after session close");
  const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${student.payload.token}` } });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${base}/api/student/dashboard`, { headers: { Authorization: `Bearer ${student.payload.token}` } });
  assert.equal(afterLogout.status, 401);
});
