import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("BLE challenge accepts a valid HMAC once and rejects invalid/replayed proofs", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attendance-api-"));
  const port = await freePort();
  const key = randomBytes(32).toString("hex");
  const beaconId = "Room 301";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir, BEACON_KEYS: JSON.stringify({ [beaconId]: key }) },
    stdio: "ignore",
  });
  t.after(async () => {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
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

  const post = (url, body, token) => fetch(`${base}${url}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  });
  const login = await post("/api/auth/login", { loginId: "T001", password: "teacher123" });
  const { token: teacherToken } = await login.json();
  assert.equal(login.status, 200);
  const sessionResponse = await post("/api/sessions", { courseId: "CS301" }, teacherToken);
  assert.equal(sessionResponse.status, 201);
  const { code } = await sessionResponse.json();
  const studentLogin = await post("/api/auth/login", { loginId: "23BCS001", password: "student123" });
  const { token: studentToken } = await studentLogin.json();
  const attemptResponse = await post("/api/attendance/attempts", { courseId: "CS301" }, studentToken);
  assert.equal(attemptResponse.status, 201);
  const { attemptId } = await attemptResponse.json();
  const challengeResponse = await post(`/api/attendance/attempts/${attemptId}/ble/challenge`, {}, studentToken);
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  assert.equal(challenge.beaconId, beaconId);

  const invalid = await post(`/api/attendance/attempts/${attemptId}/ble`, { challengeId: challenge.challengeId, proof: `${beaconId}|${challenge.nonce}|${"0".repeat(64)}` }, studentToken);
  assert.equal(invalid.status, 400);
  const digest = createHmac("sha256", Buffer.from(key, "hex")).update(`${challenge.nonce}|${beaconId}`).digest("hex");
  const proof = `${beaconId}|${challenge.nonce}|${digest}`;
  const valid = await post(`/api/attendance/attempts/${attemptId}/ble`, { challengeId: challenge.challengeId, proof }, studentToken);
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { verified: true });
  const replay = await post(`/api/attendance/attempts/${attemptId}/ble`, { challengeId: challenge.challengeId, proof }, studentToken);
  assert.equal(replay.status, 400);

  const close = await post(`/api/sessions/${code}/close`, {}, teacherToken);
  assert.equal(close.status, 200);
});
