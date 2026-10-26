import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provisioner = path.join(backendDir, "scripts", "provision-users.js");

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test("production provisions password accounts and authenticates both roles without OAuth", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attendance-password-provision-"));
  const inputPath = path.join(dataDir, "approved-users.json");
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dataDir,
    STUDENT_ROSTER: "25BCS001",
    PROFESSOR_ROSTER: "faculty01",
    CORS_ORIGINS: "https://attendance.test",
  };
  let server;
  t.after(async () => {
    if (server) {
      server.kill();
      if (server.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  let result = spawnSync(process.execPath, [provisioner, "init"], { cwd: backendDir, env, encoding: "utf8" });
  assert.equal(result.status, 0, `the production database should initialize: ${result.stderr}`);
  await writeFile(inputPath, JSON.stringify({
    students: [{ studentId: "25BCS001", name: "Example Student", password: "StudentTestPassword!23" }],
    professors: [{ loginId: "faculty01", name: "Example Professor", password: "ProfessorTestPassword!23" }],
  }));
  result = spawnSync(process.execPath, [provisioner, "import", inputPath], { cwd: backendDir, env, encoding: "utf8" });
  assert.equal(result.status, 0, "approved password accounts should be imported");

  const database = new DatabaseSync(path.join(dataDir, "attendance.sqlite"), { readOnly: true });
  const state = database.prepare("SELECT login_id,student_id,role,password_hash FROM users ORDER BY role").all();
  database.close();
  assert.equal(state.find((user) => user.role === "student").student_id, "25BCS001");
  assert.match(state.find((user) => user.role === "student").password_hash, /^scrypt\$/);
  assert.equal(state.find((user) => user.role === "student").password_hash.includes("StudentTestPassword!23"), false);
  assert.equal(state.find((user) => user.role === "professor").login_id, "faculty01");
  assert.match(state.find((user) => user.role === "professor").password_hash, /^scrypt\$/);

  server = spawn(process.execPath, ["src/server.js"], { cwd: backendDir, env, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode !== null) assert.fail("The production API should start with password accounts.");
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch { /* wait for listen */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "the production API should become healthy");

  const authStatus = await fetch(`${base}/api/auth/status`).then((response) => response.json());
  assert.equal(authStatus.passwordLoginEnabled, true);
  assert.equal(authStatus.studentRegistrationEnabled, false);
  assert.equal(authStatus.professorRegistrationEnabled, false);
  const studentLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: "25BCS001", password: "StudentTestPassword!23" }),
  });
  assert.equal(studentLogin.status, 200);
  const studentSession = await studentLogin.json();
  assert.equal(studentSession.user.role, "student");
  for (const route of ["/api/auth/google/status", "/api/auth/google/start", "/api/auth/google/callback"]) {
    const response = await fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${studentSession.token}` } });
    assert.equal(response.status, 404);
  }
  const exchange = await fetch(`${base}/api/auth/google/exchange`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${studentSession.token}` },
    body: JSON.stringify({ ticket: "obsolete" }),
  });
  assert.equal(exchange.status, 404);
  const professorLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: "faculty01", password: "ProfessorTestPassword!23" }),
  });
  assert.equal(professorLogin.status, 200);
  assert.equal((await professorLogin.json()).user.role, "professor");
  const rejectedLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: "25BCS001", password: "WrongTestPassword!23" }),
  });
  assert.equal(rejectedLogin.status, 401);

  const rejectedPath = path.join(dataDir, "rejected-users.json");
  await writeFile(rejectedPath, JSON.stringify({
    students: [{ studentId: "25BCS002", name: "Unapproved Student", password: "AnotherTestPassword!23" }],
    professors: [],
  }));
  result = spawnSync(process.execPath, [provisioner, "import", rejectedPath], { cwd: backendDir, env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
});
