import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tinyJpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAf/2Q==";

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForHealth(base) {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("API did not start");
}

async function removeTempDir(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error.code) || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function startFaceMock() {
  const enrolled = new Set();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : {};
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const enrolledMatch = url.pathname.match(/^\/enrolled\/([^/]+)$/);
    if (req.method === "GET" && enrolledMatch) return send(200, { enrolled: enrolled.has(decodeURIComponent(enrolledMatch[1])) });
    if (req.method === "POST" && url.pathname === "/enroll") {
      enrolled.add(json.studentId);
      return send(200, { enrolled: true });
    }
    send(404, { detail: "not found" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, enrolled }));
  });
}

async function startApi({ dataDir, port, env }) {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir, ...env },
    stdio: "ignore",
  });
  await waitForHealth(`http://127.0.0.1:${port}`);
  return child;
}

test("registration stays closed until STUDENT_ROSTER is set", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attendance-roster-"));
  const port = await freePort();
  const child = await startApi({ dataDir, port, env: { STUDENT_ROSTER: "", STUDENT_ROSTER_RANGE: "", CORS_ORIGINS: "http://trusted.test" } });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    await removeTempDir(dataDir);
  });
  const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.equal(health.rosterConfigured, false);
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rollNumber: "23BCS001", name: "Student", password: "password123", faceImage: tinyJpeg }),
  });
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "ROSTER_NOT_CONFIGURED");
});

test("authorized students can register and existing students can enroll a face", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attendance-enroll-"));
  const port = await freePort();
  const face = await startFaceMock();
  const child = await startApi({
    dataDir,
    port,
    env: { STUDENT_ROSTER: "23BCS006", STUDENT_ROSTER_RANGE: "001-300", FACE_SERVICE_URL: `http://127.0.0.1:${face.port}` },
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    face.server.close();
    face.server.closeAllConnections?.();
    await removeTempDir(dataDir);
  });

  const blocked = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rollNumber: "23BCS301", name: "Other", password: "password123", faceImage: tinyJpeg }),
  });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, "NOT_ON_ROSTER");

  for (const invalidRollNumber of ["23XYZ006", "23BCS06", "23BEC1000"]) {
    const invalid = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rollNumber: invalidRollNumber, name: "Invalid Student", password: "password123", faceImage: tinyJpeg }),
    });
    assert.equal(invalid.status, 400, `${invalidRollNumber} should be rejected`);
    assert.equal((await invalid.json()).error.code, "INVALID_REGISTRATION");
  }

  for (const outOfRangeRollNumber of ["23BCS000", "24BDA301"]) {
    const outOfRange = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rollNumber: outOfRangeRollNumber, name: "Out of range", password: "password123", faceImage: tinyJpeg }),
    });
    assert.equal(outOfRange.status, 403, `${outOfRangeRollNumber} should be outside the configured roster range`);
    assert.equal((await outOfRange.json()).error.code, "NOT_ON_ROSTER");
  }

  for (const rollNumber of ["23BCS006", "24BDA007", "25BEC008", "99BEC300"]) {
    const registered = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rollNumber, name: "Roster Student", password: "password123", faceImage: tinyJpeg }),
    });
    const payload = await registered.json();
    assert.equal(registered.status, 201, `${rollNumber}: ${payload.error?.message || "registration failed"}`);
    assert.equal(payload.user.loginId, rollNumber);
    assert.equal(face.enrolled.has(rollNumber), true);
  }

  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: "23BCS001", password: "student123" }),
  });
  const { token } = await login.json();
  const before = await fetch(`http://127.0.0.1:${port}/api/student/face`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await before.json()).enrolled, false);
  const enroll = await fetch(`http://127.0.0.1:${port}/api/student/face`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ faceImage: tinyJpeg }),
  });
  assert.equal(enroll.status, 200);
  assert.equal((await enroll.json()).enrolled, true);
  const after = await fetch(`http://127.0.0.1:${port}/api/student/face`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await after.json()).enrolled, true);
});
