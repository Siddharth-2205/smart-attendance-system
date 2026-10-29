import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(backendDir, "data"));
mkdirSync(dataDir, { recursive: true });
export const sql = new DatabaseSync(path.join(dataDir, "attendance.sqlite"));
sql.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const tableExists = (name) => Boolean(sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const migrations = [
  {
    version: 1,
    apply() {
      // Retain the original tables under legacy names until their rows have been copied.
      if (tableExists("courses")) sql.exec("ALTER TABLE courses RENAME TO courses_legacy");
      if (tableExists("attendance_records")) sql.exec("ALTER TABLE attendance_records RENAME TO attendance_records_legacy");
      sql.exec(`
        CREATE TABLE users (
          login_id TEXT PRIMARY KEY COLLATE NOCASE,
          student_id TEXT UNIQUE,
          email TEXT,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('student','professor')),
          password_hash TEXT NOT NULL,
          tokens_json TEXT NOT NULL DEFAULT '[]',
          demo_account INTEGER NOT NULL DEFAULT 0 CHECK(demo_account IN (0,1)),
          CHECK((role='student' AND student_id IS NOT NULL) OR (role='professor' AND student_id IS NULL))
        );
        CREATE TABLE courses (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          code TEXT NOT NULL,
          professor_id TEXT NOT NULL REFERENCES users(login_id) ON UPDATE CASCADE ON DELETE RESTRICT,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          days_json TEXT NOT NULL,
          beacon_id TEXT NOT NULL,
          students INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE course_enrollments (
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          student_id TEXT NOT NULL REFERENCES users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
          PRIMARY KEY(course_id, student_id)
        );
        CREATE TABLE attendance_sessions (
          code TEXT PRIMARY KEY,
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
          beacon_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('open','closed')),
          created_at TEXT NOT NULL,
          closed_at TEXT,
          qr_json TEXT,
          UNIQUE(code, course_id)
        );
        CREATE UNIQUE INDEX one_open_session_per_course ON attendance_sessions(course_id) WHERE status='open';
        CREATE TABLE attendance_attempts (
          attempt_id TEXT PRIMARY KEY,
          student_id TEXT NOT NULL REFERENCES users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
          session_id TEXT NOT NULL,
          required_factors_json TEXT NOT NULL,
          factors_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          challenge_json TEXT,
          ble_challenge_json TEXT,
          qr_verified_at TEXT,
          completed_at TEXT,
          FOREIGN KEY(session_id, course_id) REFERENCES attendance_sessions(code, course_id) ON DELETE RESTRICT
        );
        CREATE INDEX attempts_student_session ON attendance_attempts(student_id, session_id);
        CREATE TABLE attendance_records (
          student_id TEXT NOT NULL REFERENCES users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
          session_id TEXT NOT NULL,
          marked_at TEXT NOT NULL,
          date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'present' CHECK(status='present'),
          verified_steps_json TEXT NOT NULL DEFAULT '["qr","face"]',
          UNIQUE(student_id, session_id),
          FOREIGN KEY(session_id, course_id) REFERENCES attendance_sessions(code, course_id) ON DELETE RESTRICT
        );
        CREATE INDEX attendance_course_date ON attendance_records(course_id, date);
        CREATE TABLE database_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);

      let state = null;
      if (tableExists("app_state")) {
        const row = sql.prepare("SELECT payload FROM app_state WHERE id=1").get();
        if (row) state = JSON.parse(row.payload);
      }
      // The old JSON file is only an import source when SQLite has no saved state.
      if (!state && process.env.NODE_ENV !== "production") {
        try { state = JSON.parse(readFileSync(path.join(dataDir, "store.json"), "utf8")); } catch { /* no legacy file */ }
      }
      state ||= { users: [], usersExtra: [], sessions: [], attempts: [], attendance: [] };
      const users = [...(state.users || []), ...(state.usersExtra || [])];
      const putUser = sql.prepare("INSERT OR REPLACE INTO users(login_id,student_id,email,name,role,password_hash,tokens_json,demo_account) VALUES(?,?,?,?,?,?,?,?)");
      for (const user of users) {
        if (!user?.loginId || !user?.role || !user?.passwordHash) continue;
        putUser.run(user.loginId, user.role === "student" ? user.studentId || user.loginId : null, user.email || null,
          user.name || user.loginId, user.role, user.passwordHash, JSON.stringify(user.tokens || []), user.demoAccount ? 1 : 0);
      }
      const legacyCourses = tableExists("courses_legacy")
        ? sql.prepare("SELECT * FROM courses_legacy").all().map((c) => ({
          id: c.id, name: c.name, code: c.code, professorId: c.professor_id, startTime: c.start_time,
          endTime: c.end_time, days: JSON.parse(c.days || "[]"), beaconId: c.beacon_id, students: c.students,
          createdAt: c.created_at, studentIds: JSON.parse(c.student_ids || "[]"),
        })) : (state.courses || []);
      const putCourse = sql.prepare("INSERT OR REPLACE INTO courses(id,name,code,professor_id,start_time,end_time,days_json,beacon_id,students,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
      const putEnrollment = sql.prepare("INSERT OR IGNORE INTO course_enrollments(course_id,student_id) VALUES(?,?)");
      for (const c of legacyCourses) {
        if (!c?.id || !c.professorId) continue;
        putCourse.run(c.id, c.name, c.code, c.professorId, c.startTime, c.endTime, JSON.stringify(c.days || []), c.beaconId || "", c.students || 0, c.createdAt || new Date().toISOString());
        for (const studentId of c.studentIds || []) putEnrollment.run(c.id, studentId);
      }
      const putSession = sql.prepare("INSERT OR REPLACE INTO attendance_sessions(code,course_id,beacon_id,status,created_at,closed_at,qr_json) VALUES(?,?,?,?,?,?,?)");
      for (const s of state.sessions || []) {
        if (!s?.code || !s.courseId || !sql.prepare("SELECT 1 FROM courses WHERE id=?").get(s.courseId)) continue;
        putSession.run(s.code, s.courseId, s.beaconId || "", s.status === "open" ? "open" : "closed", s.createdAt || new Date().toISOString(), s.closedAt || null, s.qr ? JSON.stringify(s.qr) : null);
      }
      const putAttempt = sql.prepare("INSERT OR REPLACE INTO attendance_attempts(attempt_id,student_id,course_id,session_id,required_factors_json,factors_json,created_at,challenge_json,ble_challenge_json,qr_verified_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
      for (const a of state.attempts || []) {
        if (!a?.attemptId || !sql.prepare("SELECT 1 FROM attendance_sessions WHERE code=?").get(a.sessionId)) continue;
        putAttempt.run(a.attemptId, a.studentId, a.courseId, a.sessionId, JSON.stringify(a.requiredFactors || ["qr", "face"]), JSON.stringify(a.factors || {}), a.createdAt || new Date().toISOString(), a.challenge ? JSON.stringify(a.challenge) : null, a.bleChallenge ? JSON.stringify(a.bleChallenge) : null, a.qrVerifiedAt || null, a.completedAt || null);
      }
      const putAttendance = sql.prepare("INSERT OR IGNORE INTO attendance_records(student_id,course_id,session_id,marked_at,date,status,verified_steps_json) VALUES(?,?,?,?,?,?,?)");
      const oldRecords = tableExists("attendance_records_legacy") ? sql.prepare("SELECT * FROM attendance_records_legacy").all() : [];
      const attendance = [...(state.attendance || [])];
      if (!attendance.length) for (const r of oldRecords) attendance.push({ studentId: r.student_id, courseId: r.course_id, sessionId: r.session_id, markedAt: r.marked_at, date: r.date });
      for (const r of attendance) {
        if (!sql.prepare("SELECT 1 FROM attendance_sessions WHERE code=?").get(r.sessionId)) continue;
        putAttendance.run(r.studentId, r.courseId, r.sessionId, r.markedAt || new Date().toISOString(), r.date || String(r.markedAt || new Date().toISOString()).slice(0, 10), r.status || "present", JSON.stringify(r.verifiedSteps || ["qr", "face"]));
      }
      if (tableExists("app_state")) sql.exec("DROP TABLE app_state");
      if (tableExists("courses_legacy")) sql.exec("DROP TABLE courses_legacy");
      if (tableExists("attendance_records_legacy")) sql.exec("DROP TABLE attendance_records_legacy");
      if (users.length) sql.prepare("INSERT OR REPLACE INTO database_meta(key,value) VALUES('initialized','true')").run();
      sql.prepare("INSERT INTO schema_migrations(version) VALUES(?)").run(1);
    },
  },
  {
    version: 2,
    apply() {
      const hasQrTtlColumn = sql.prepare("PRAGMA table_info(courses)").all().some((column) => column.name === "qr_ttl_seconds");
      if (!hasQrTtlColumn) sql.exec("ALTER TABLE courses ADD COLUMN qr_ttl_seconds INTEGER NOT NULL DEFAULT 5 CHECK(qr_ttl_seconds BETWEEN 5 AND 120)");
      sql.prepare("INSERT INTO schema_migrations(version) VALUES(?)").run(2);
    },
  },
  {
    version: 3,
    apply() {
      const hasRosterColumn = sql.prepare("PRAGMA table_info(attendance_sessions)").all().some((column) => column.name === "roster_json");
      if (!hasRosterColumn) sql.exec("ALTER TABLE attendance_sessions ADD COLUMN roster_json TEXT NOT NULL DEFAULT '[]'");
      sql.prepare("INSERT INTO schema_migrations(version) VALUES(?)").run(3);
    },
  },
  {
    version: 4,
    apply() {
      sql.exec(`
        CREATE TABLE attendance_records_next (
          student_id TEXT NOT NULL REFERENCES users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
          session_id TEXT NOT NULL,
          marked_at TEXT NOT NULL,
          date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present','late','excused')),
          verified_steps_json TEXT NOT NULL DEFAULT '["qr","face"]',
          note TEXT NOT NULL DEFAULT '',
          UNIQUE(student_id, session_id),
          FOREIGN KEY(session_id, course_id) REFERENCES attendance_sessions(code, course_id) ON DELETE RESTRICT
        );
        INSERT INTO attendance_records_next(student_id,course_id,session_id,marked_at,date,status,verified_steps_json)
          SELECT student_id,course_id,session_id,marked_at,date,status,verified_steps_json FROM attendance_records;
        DROP INDEX IF EXISTS attendance_course_date;
        DROP TABLE attendance_records;
        ALTER TABLE attendance_records_next RENAME TO attendance_records;
        CREATE INDEX attendance_course_date ON attendance_records(course_id, date);
      `);
      sql.prepare("INSERT INTO schema_migrations(version) VALUES(?)").run(4);
    },
  },
  {
    version: 5,
    apply() {
      sql.exec(`
        ALTER TABLE courses ADD COLUMN attendance_threshold INTEGER NOT NULL DEFAULT 75 CHECK(attendance_threshold BETWEEN 1 AND 100);
        CREATE TABLE attendance_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id TEXT NOT NULL REFERENCES users(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
          session_id TEXT NOT NULL,
          actor_id TEXT NOT NULL REFERENCES users(login_id) ON UPDATE CASCADE ON DELETE RESTRICT,
          actor_role TEXT NOT NULL CHECK(actor_role IN ('student','professor')),
          previous_status TEXT NOT NULL,
          new_status TEXT NOT NULL CHECK(new_status IN ('present','late','excused')),
          source TEXT NOT NULL CHECK(source IN ('student_verification','professor_update')),
          note TEXT NOT NULL DEFAULT '',
          changed_at TEXT NOT NULL,
          FOREIGN KEY(session_id, course_id) REFERENCES attendance_sessions(code, course_id) ON DELETE RESTRICT
        );
        CREATE INDEX attendance_audit_course_time ON attendance_audit_log(course_id, changed_at DESC);
      `);
      sql.prepare("INSERT INTO schema_migrations(version) VALUES(?)").run(5);
    },
  },
];

sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
for (const migration of migrations) {
  if (sql.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(migration.version)) continue;
  sql.exec("BEGIN IMMEDIATE");
  try { migration.apply(); sql.exec("COMMIT"); }
  catch (error) { sql.exec("ROLLBACK"); throw error; }
}

const parse = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
export function loadState() {
  const users = sql.prepare("SELECT * FROM users ORDER BY login_id").all().map((u) => ({
    loginId: u.login_id, ...(u.role === "student" ? { studentId: u.student_id } : {}), ...(u.email ? { email: u.email } : {}),
    name: u.name, role: u.role, passwordHash: u.password_hash, tokens: parse(u.tokens_json, []), ...(u.demo_account ? { demoAccount: true } : {}),
  }));
  const courses = sql.prepare("SELECT * FROM courses ORDER BY id").all().map((c) => ({
    id: c.id, name: c.name, code: c.code, professorId: c.professor_id,
    days: parse(c.days_json, []), beaconId: c.beacon_id, students: c.students, qrTtlSeconds: c.qr_ttl_seconds, attendanceThreshold: c.attendance_threshold, createdAt: c.created_at,
    studentIds: sql.prepare("SELECT student_id FROM course_enrollments WHERE course_id=? ORDER BY student_id").all(c.id).map((r) => r.student_id),
  }));
  const sessions = sql.prepare("SELECT * FROM attendance_sessions ORDER BY created_at").all().map((s) => ({
    code: s.code, courseId: s.course_id, beaconId: s.beacon_id, status: s.status, createdAt: s.created_at,
    ...(s.closed_at ? { closedAt: s.closed_at } : {}), qr: parse(s.qr_json, null), rosterStudentIds: parse(s.roster_json, []),
  }));
  const attempts = sql.prepare("SELECT * FROM attendance_attempts ORDER BY created_at").all().map((a) => ({
    attemptId: a.attempt_id, studentId: a.student_id, courseId: a.course_id, sessionId: a.session_id,
    requiredFactors: parse(a.required_factors_json, ["qr", "face"]), factors: parse(a.factors_json, {}), createdAt: a.created_at,
    ...(a.challenge_json ? { challenge: parse(a.challenge_json, null) } : {}), ...(a.ble_challenge_json ? { bleChallenge: parse(a.ble_challenge_json, null) } : {}),
    ...(a.qr_verified_at ? { qrVerifiedAt: a.qr_verified_at } : {}), ...(a.completed_at ? { completedAt: a.completed_at } : {}),
  }));
  const attendance = sql.prepare("SELECT * FROM attendance_records ORDER BY marked_at").all().map((r) => ({
    studentId: r.student_id, courseId: r.course_id, sessionId: r.session_id, markedAt: r.marked_at, date: r.date,
    status: r.status, verifiedSteps: parse(r.verified_steps_json, []), note: r.note || "",
    studentName: users.find((u) => u.studentId === r.student_id)?.name,
    courseName: courses.find((c) => c.id === r.course_id)?.name,
  }));
  return { users: users.filter((u) => u.role === "student"), usersExtra: users.filter((u) => u.role === "professor"), courses, sessions, attempts, attendance };
}

export function saveState(state) {
  sql.exec("BEGIN IMMEDIATE");
  try {
    const putUser = sql.prepare("INSERT INTO users(login_id,student_id,email,name,role,password_hash,tokens_json,demo_account) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(login_id) DO UPDATE SET student_id=excluded.student_id,email=excluded.email,name=excluded.name,role=excluded.role,password_hash=excluded.password_hash,tokens_json=excluded.tokens_json,demo_account=excluded.demo_account");
    for (const u of [...state.users, ...state.usersExtra]) putUser.run(u.loginId, u.role === "student" ? u.studentId : null, u.email || null, u.name, u.role, u.passwordHash, JSON.stringify(u.tokens || []), u.demoAccount ? 1 : 0);
    const putCourse = sql.prepare("INSERT INTO courses(id,name,code,professor_id,start_time,end_time,days_json,beacon_id,students,created_at,qr_ttl_seconds,attendance_threshold) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,code=excluded.code,professor_id=excluded.professor_id,start_time=excluded.start_time,end_time=excluded.end_time,days_json=excluded.days_json,beacon_id=excluded.beacon_id,students=excluded.students,created_at=excluded.created_at,qr_ttl_seconds=excluded.qr_ttl_seconds,attendance_threshold=excluded.attendance_threshold");
    const putEnrollment = sql.prepare("INSERT OR IGNORE INTO course_enrollments(course_id,student_id) VALUES(?,?)");
    for (const c of state.courses) {
      putCourse.run(c.id, c.name, c.code, c.professorId, c.startTime || "00:00", c.endTime || "23:59", JSON.stringify(c.days || []), c.beaconId || "", c.students || 0, c.createdAt || new Date().toISOString(), c.qrTtlSeconds || 5, c.attendanceThreshold || 75);
      const ids = new Set(c.studentIds || []);
      for (const row of sql.prepare("SELECT student_id FROM course_enrollments WHERE course_id=?").all(c.id)) if (!ids.has(row.student_id)) sql.prepare("DELETE FROM course_enrollments WHERE course_id=? AND student_id=?").run(c.id, row.student_id);
      for (const id of ids) putEnrollment.run(c.id, id);
    }
    const courseIds = new Set(state.courses.map((c) => c.id));
    for (const row of sql.prepare("SELECT id FROM courses").all()) if (!courseIds.has(row.id)) sql.prepare("DELETE FROM courses WHERE id=?").run(row.id);
    const putSession = sql.prepare("INSERT INTO attendance_sessions(code,course_id,beacon_id,status,created_at,closed_at,qr_json,roster_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET course_id=excluded.course_id,beacon_id=excluded.beacon_id,status=excluded.status,created_at=excluded.created_at,closed_at=excluded.closed_at,qr_json=excluded.qr_json,roster_json=excluded.roster_json");
    for (const s of state.sessions) putSession.run(s.code, s.courseId, s.beaconId || "", s.status, s.createdAt, s.closedAt || null, s.qr ? JSON.stringify(s.qr) : null, JSON.stringify(s.rosterStudentIds || []));
    const putAttempt = sql.prepare("INSERT INTO attendance_attempts(attempt_id,student_id,course_id,session_id,required_factors_json,factors_json,created_at,challenge_json,ble_challenge_json,qr_verified_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET student_id=excluded.student_id,course_id=excluded.course_id,session_id=excluded.session_id,required_factors_json=excluded.required_factors_json,factors_json=excluded.factors_json,created_at=excluded.created_at,challenge_json=excluded.challenge_json,ble_challenge_json=excluded.ble_challenge_json,qr_verified_at=excluded.qr_verified_at,completed_at=excluded.completed_at");
    for (const a of state.attempts) putAttempt.run(a.attemptId, a.studentId, a.courseId, a.sessionId, JSON.stringify(a.requiredFactors || []), JSON.stringify(a.factors || {}), a.createdAt, a.challenge ? JSON.stringify(a.challenge) : null, a.bleChallenge ? JSON.stringify(a.bleChallenge) : null, a.qrVerifiedAt || null, a.completedAt || null);
    sql.exec("COMMIT");
  } catch (error) { sql.exec("ROLLBACK"); throw error; }
}

export function completeAttendanceTransaction(record, attempt) {
  sql.exec("BEGIN IMMEDIATE");
  try {
    const storedAttempt = sql.prepare("SELECT student_id,course_id,session_id,required_factors_json,factors_json,completed_at FROM attendance_attempts WHERE attempt_id=?").get(attempt.attemptId);
    const activeSession = storedAttempt && sql.prepare("SELECT course_id FROM attendance_sessions WHERE code=? AND status='open'").get(storedAttempt.session_id);
    const enrolled = storedAttempt && sql.prepare("SELECT 1 FROM course_enrollments WHERE course_id=? AND student_id=?").get(storedAttempt.course_id, storedAttempt.student_id);
    const factors = storedAttempt ? parse(storedAttempt.factors_json, {}) : {};
    const required = storedAttempt ? parse(storedAttempt.required_factors_json, []) : [];
    if (!storedAttempt || storedAttempt.completed_at || !activeSession || activeSession.course_id !== storedAttempt.course_id
      || !enrolled || storedAttempt.student_id !== record.studentId || storedAttempt.course_id !== record.courseId
      || storedAttempt.session_id !== record.sessionId || !required.every((factor) => factors[factor])) {
      sql.exec("ROLLBACK"); return false;
    }
    const result = sql.prepare("INSERT OR IGNORE INTO attendance_records(student_id,course_id,session_id,marked_at,date,status,verified_steps_json) VALUES(?,?,?,?,?,?,?)")
      .run(record.studentId, record.courseId, record.sessionId, record.markedAt, record.date, record.status, JSON.stringify(record.verifiedSteps));
    if (!result.changes) { sql.exec("ROLLBACK"); return false; }
    const updated = sql.prepare("UPDATE attendance_attempts SET completed_at=? WHERE attempt_id=? AND completed_at IS NULL")
      .run(record.markedAt, attempt.attemptId);
    if (!updated.changes) { sql.exec("ROLLBACK"); return false; }
    sql.exec("COMMIT");
    return true;
  } catch (error) { sql.exec("ROLLBACK"); throw error; }
}

export function setAttendanceStatus({ studentId, courseId, sessionId, markedAt, date, status, note }) {
  sql.exec("BEGIN IMMEDIATE");
  try {
    if (status === "absent") {
      sql.prepare("DELETE FROM attendance_records WHERE student_id=? AND session_id=?").run(studentId, sessionId);
      sql.exec("COMMIT");
      return true;
    }
    sql.prepare(`
      INSERT INTO attendance_records(student_id,course_id,session_id,marked_at,date,status,verified_steps_json,note)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(student_id,session_id) DO UPDATE SET
        course_id=excluded.course_id, marked_at=excluded.marked_at, date=excluded.date,
        status=excluded.status, note=excluded.note
    `).run(studentId, courseId, sessionId, markedAt, date, status, "[]", note);
    sql.exec("COMMIT");
    return true;
  } catch (error) { sql.exec("ROLLBACK"); throw error; }
}
