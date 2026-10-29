import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startApi(dataDir, port) {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) assert.fail(`API exited during migration with code ${child.exitCode}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return { child, base }; } catch { /* wait for listen */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("API did not start after applying its database migration");
}

test("versioned migration imports the previous SQLite state and store.json fallback", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "attendance-legacy-migration-"));
  const port = await freePort();
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill(); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  const salt = randomBytes(16).toString("hex");
  const passwordHash = `scrypt$${salt}$${scryptSync("MigrationPassword!23", salt, 32).toString("hex")}`;
  const legacyState = {
    users: [{ loginId: "25BCS001", studentId: "25BCS001", name: "Migrated Student", role: "student", passwordHash, tokens: [] }],
    usersExtra: [{ loginId: "faculty01", name: "Migrated Professor", role: "professor", passwordHash, tokens: [] }],
    sessions: [{ code: "ABC12345EF", courseId: "C-1", beaconId: "Room 1", status: "closed", createdAt: "2026-10-25T10:00:00.000Z", closedAt: "2026-10-25T11:00:00.000Z", qr: null }],
    attempts: [],
    attendance: [{ studentId: "25BCS001", courseId: "C-1", sessionId: "ABC12345EF", studentName: "Migrated Student", courseName: "Legacy Class", status: "present", verifiedSteps: ["qr", "face"], markedAt: "2026-10-25T10:30:00.000Z", date: "2026-10-25" }],
  };
  const legacyDb = new DatabaseSync(path.join(dataDir, "attendance.sqlite"));
  legacyDb.exec(`CREATE TABLE app_state(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
    CREATE TABLE courses(id TEXT PRIMARY KEY,name TEXT NOT NULL,code TEXT NOT NULL,professor_id TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,days TEXT NOT NULL,beacon_id TEXT NOT NULL,students INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,student_ids TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE attendance_records(student_id TEXT NOT NULL,course_id TEXT NOT NULL,session_id TEXT NOT NULL,marked_at TEXT NOT NULL,date TEXT NOT NULL,UNIQUE(student_id,session_id));`);
  legacyDb.prepare("INSERT INTO app_state(id,payload) VALUES(1,?)").run(JSON.stringify(legacyState));
  legacyDb.prepare("INSERT INTO courses VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("C-1", "Legacy Class", "LC1", "faculty01", "09:00", "10:00", '["Monday"]', "Room 1", 1, "2026-10-01T00:00:00.000Z", '["25BCS001"]');
  legacyDb.prepare("INSERT INTO attendance_records VALUES(?,?,?,?,?)").run("25BCS001", "C-1", "ABC12345EF", "2026-10-25T10:30:00.000Z", "2026-10-25");
  legacyDb.close();

  const { child: started, base } = await startApi(dataDir, port);
  child = started;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: "25BCS001", password: "MigrationPassword!23" }),
  });
  assert.equal(login.status, 200, "migrated student accounts should remain usable");
  const session = await login.json();
  const dashboard = await fetch(`${base}/api/student/dashboard`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(dashboard.status, 200);
  const migratedDb = new DatabaseSync(path.join(dataDir, "attendance.sqlite"), { readOnly: true });
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 5);
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM users WHERE role='student'").get().count, 1);
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE student_id='25BCS001'").get().count, 1);
  assert.ok(migratedDb.prepare("PRAGMA table_info(attendance_records)").all().some((column) => column.name === "note"));
  assert.ok(migratedDb.prepare("PRAGMA table_info(courses)").all().some((column) => column.name === "attendance_threshold"));
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='attendance_audit_log'").get().count, 1);
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='app_state'").get().count, 0);
  assert.equal(migratedDb.prepare("PRAGMA foreign_key_check").all().length, 0);
  migratedDb.close();

  // With no legacy SQLite state, the former JSON store remains a supported one-time import source.
  const jsonDir = await mkdtemp(path.join(os.tmpdir(), "attendance-store-json-migration-"));
  t.after(() => rm(jsonDir, { recursive: true, force: true }));
  await writeFile(path.join(jsonDir, "store.json"), JSON.stringify({ ...legacyState, courses: [{ id: "C-1", name: "Legacy Class", code: "LC1", professorId: "faculty01", startTime: "09:00", endTime: "10:00", days: ["Monday"], beaconId: "Room 1", students: 1, createdAt: "2026-10-01T00:00:00.000Z", studentIds: ["25BCS001"] }] }));
  const jsonDb = new DatabaseSync(path.join(jsonDir, "attendance.sqlite"));
  jsonDb.close();
  const processResult = await new Promise((resolve) => {
    const migration = spawn(process.execPath, ["--input-type=module", "-e", `import './src/database.js'`], {
      cwd: backendDir,
      env: { ...process.env, NODE_ENV: "development", DATA_DIR: jsonDir },
      stdio: "ignore",
    });
    migration.once("exit", (code) => resolve(code));
  });
  assert.equal(processResult, 0, "legacy JSON-only development state should migrate");
  const importedDb = new DatabaseSync(path.join(jsonDir, "attendance.sqlite"), { readOnly: true });
  assert.equal(importedDb.prepare("SELECT COUNT(*) AS count FROM users WHERE student_id='25BCS001'").get().count, 1);
  assert.equal(importedDb.prepare("SELECT COUNT(*) AS count FROM attendance_records").get().count, 1);
  importedDb.close();
});
