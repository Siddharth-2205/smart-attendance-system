import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { completeAttendanceTransaction, loadState, saveState, setAttendanceStatus, sql } from "./database.js";

const port = Number(process.env.PORT || 4000);
const production = process.env.NODE_ENV === "production";
const faceServiceHostport = process.env.FACE_SERVICE_HOSTPORT;
const faceServiceUrl = process.env.FACE_SERVICE_URL || (faceServiceHostport ? `http://${faceServiceHostport}` : "http://127.0.0.1:5001");
const faceServiceToken = process.env.FACE_SERVICE_TOKEN || "";
const defaultQrTtlSeconds = Math.max(5, Math.min(120, Number(process.env.QR_TTL_SECONDS) || 5));
const allowedOrigins = new Set((process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,https://localhost:5174,https://127.0.0.1:5174")
  .split(",").map((origin) => origin.trim()).filter(Boolean));
const bleServiceUuid = "6f3a0001-5f3d-4b7a-9c2a-2d8f1e0a0001";
const bleChallengeUuid = "6f3a0002-5f3d-4b7a-9c2a-2d8f1e0a0002";
const bleResponseUuid = "6f3a0003-5f3d-4b7a-9c2a-2d8f1e0a0003";
let beaconKeys = {};
try { beaconKeys = JSON.parse(process.env.BEACON_KEYS || "{}"); } catch { throw new Error("BEACON_KEYS must be valid JSON."); }
const now = () => new Date().toISOString();
function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(value, salt, 32).toString("hex")}`;
}
function verifyPassword(value, stored) {
  if (typeof stored !== "string") return false;
  if (stored.startsWith("scrypt$")) {
    const [, salt, digest] = stored.split("$");
    if (!/^[a-f0-9]{32}$/i.test(salt || "") || !/^[a-f0-9]{64}$/i.test(digest || "")) return false;
    return timingSafeEqual(Buffer.from(digest, "hex"), scryptSync(value, salt, 32));
  }
  if (!/^[a-f0-9]{64}$/i.test(stored)) return false;
  return timingSafeEqual(Buffer.from(stored, "hex"), scryptSync(value, "smart-attendance-local", 32));
}
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const sessionTtlSeconds = Math.max(600, Math.min(86_400, Number(process.env.SESSION_TTL_SECONDS) || 28_800));
const loginFailureWindows = new Map();
const passwordResetChallenges = new Map();
const loginFailureLimit = 10;
const loginFailureWindowMs = 15 * 60 * 1000;
const dummyPasswordHash = hashPassword(randomBytes(32).toString("hex"));
function loginFailureKey(loginId) {
  return createHash("sha256").update(String(loginId || "").trim().toUpperCase()).digest("hex");
}
function checkLoginRateLimit(key) {
  const time = Date.now();
  const window = loginFailureWindows.get(key);
  if (window && window.resetAt > time && window.failures >= loginFailureLimit) {
    throw fail(429, "LOGIN_RATE_LIMITED", "Too many unsuccessful sign-in attempts. Try again later.");
  }
}
function recordLoginFailure(key) {
  const time = Date.now();
  if (loginFailureWindows.size >= 10_000) {
    for (const [storedKey, window] of loginFailureWindows) if (window.resetAt <= time) loginFailureWindows.delete(storedKey);
    if (loginFailureWindows.size >= 10_000) loginFailureWindows.clear();
  }
  let window = loginFailureWindows.get(key);
  if (!window || window.resetAt <= time) window = { failures: 0, resetAt: time + loginFailureWindowMs };
  window.failures += 1;
  loginFailureWindows.set(key, window);
}
function issueSession(user) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000).toISOString();
  user.tokens = (user.tokens || []).filter((entry) => typeof entry === "object" && Date.parse(entry.expiresAt) > Date.now()).slice(-9);
  user.tokens.push({ digest: `sha256$${hashToken(token)}`, expiresAt });
  return { token, expiresAt };
}
const studentIdPattern = /^\d{2}(?:BCS|BDA|BEC)\d{3}$/;
const studentRoster = new Set(
  (process.env.STUDENT_ROSTER || "")
    .split(",")
    .map((loginId) => loginId.trim().toUpperCase())
    .filter(Boolean)
);
const rosterRangeText = (process.env.STUDENT_ROSTER_RANGE || "").trim();
const rosterRangeMatch = rosterRangeText.match(/^(\d{3})-(\d{3})$/);
if (rosterRangeText && (!rosterRangeMatch || Number(rosterRangeMatch[1]) < 1 || Number(rosterRangeMatch[2]) > 999 || Number(rosterRangeMatch[1]) > Number(rosterRangeMatch[2]))) {
  throw new Error("STUDENT_ROSTER_RANGE must be a valid three-digit range such as 001-300.");
}
const rosterRange = rosterRangeMatch ? { min: Number(rosterRangeMatch[1]), max: Number(rosterRangeMatch[2]) } : null;
const rosterConfigured = studentRoster.size > 0 || rosterRange !== null;
if (production) {
  if (!process.env.DATA_DIR || !path.isAbsolute(process.env.DATA_DIR)) throw new Error("Production DATA_DIR must point to an absolute persistent-storage path.");
  if (!process.env.FACE_SERVICE_URL && !faceServiceHostport) throw new Error("Configure FACE_SERVICE_URL or FACE_SERVICE_HOSTPORT for the private face service.");
  if (faceServiceToken.length < 32) throw new Error("Configure a private FACE_SERVICE_TOKEN with at least 32 characters in both services.");
  if (rosterRange) throw new Error("STUDENT_ROSTER_RANGE is development-only. Configure an exact institutional STUDENT_ROSTER in production.");
  if (!studentRoster.size) throw new Error("Configure an exact institutional STUDENT_ROSTER before starting in production.");
  if (process.env.ALLOW_DEMO_ACCOUNTS === "true") throw new Error("Demo accounts cannot be enabled in production.");
  if (allowedOrigins.size !== 1 || [...allowedOrigins].some((origin) => {
    try { const parsed = new URL(origin); return parsed.protocol !== "https:" || parsed.origin !== origin; }
    catch { return true; }
  })) throw new Error("Production CORS_ORIGINS must contain exactly one HTTPS origin without a path.");
}
const isOnStudentRoster = (loginId) => studentRoster.has(loginId) || (
  rosterRange && studentIdPattern.test(loginId)
  && Number(loginId.slice(-3)) >= rosterRange.min
  && Number(loginId.slice(-3)) <= rosterRange.max
);
const initialCourses = [
  { id: "CS301", name: "Database Management Systems", code: "CS301", beaconId: "Room 301", students: 5, studentIds: ["23BCS001", "23BCS002", "23BCS003", "23BCS004", "23BCS005"] },
  { id: "CS302", name: "Computer Networks", code: "CS302", beaconId: "Room 302", students: 5, studentIds: ["23BCS001", "23BCS002", "23BCS003", "23BCS004", "23BCS005"] },
  { id: "CS303", name: "Software Engineering", code: "CS303", beaconId: "Room 303", students: 5, studentIds: ["23BCS001", "23BCS002", "23BCS003", "23BCS004", "23BCS005"] },
];
const seed = () => ({
  users: ["23BCS001", "23BCS002", "23BCS003", "23BCS004", "23BCS005"].map((id, i) => ({ loginId: id, studentId: id, name: `Student ${i + 1}`, role: "student", passwordHash: hashPassword("student123"), faceImage: null, demoAccount: true })),
  usersExtra: [{ loginId: "T001", name: "Professor", role: "professor", passwordHash: hashPassword("teacher123"), demoAccount: true }],
  sessions: [], attempts: [], attendance: []
});
let db;
function save() { saveState(db); }
async function load() {
  db = loadState();
  // Bearer credentials are stored only as SHA-256 digests; legacy raw tokens expire on upgrade.
  for (const user of [...db.users, ...db.usersExtra]) {
    user.tokens = (user.tokens || []).filter((entry) => typeof entry === "object" && typeof entry.digest === "string" && entry.digest.startsWith("sha256$") && Date.parse(entry.expiresAt) > Date.now());
  }
  db.attempts ||= [];
  db.sessions ||= [];
  db.attendance ||= [];
  // Migrate seeded demo accounts created before student passwords were required.
  for (const user of db.users) {
    if (!production && /^23BCS00[1-5]$/.test(user.loginId) && /^Student [1-5]$/.test(user.name || "")) user.demoAccount = true;
    if (!production && /^23BCS00[1-5]$/.test(user.loginId) && !user.passwordHash) user.passwordHash = hashPassword("student123");
    delete user.faceImage;
  }
  if (!db.users.length && !db.usersExtra.length && !production) {
    const seeded = seed(); db.users = seeded.users; db.usersExtra = seeded.usersExtra;
  }
  if (!production && !db.usersExtra.some((u) => u.loginId === "T001")) db.usersExtra.push(seed().usersExtra[0]);
  if (!production) {
    const demoProfessor = db.usersExtra.find((user) => user.loginId === "T001" && user.name === "Professor");
    if (demoProfessor) demoProfessor.demoAccount = true;
  }
  if (!db.courses.length && !production) db.courses = initialCourses.map((c) => ({ ...c, professorId: "T001", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], createdAt: now() }));
  db.courses = db.courses.map((course) => ({
    ...course,
    studentIds: Array.isArray(course.studentIds) && course.studentIds.length
      ? [...new Set(course.studentIds.map((id) => String(id).toUpperCase()))]
      : db.users.map((student) => student.studentId).filter(Boolean),
  }));
  db.attendance = db.attendance.map((record) => ({ ...record, date: record.date || String(record.markedAt || now()).slice(0, 10) }));
  save();
}
const allUsers = () => [...db.users, ...db.usersExtra];
const safeUser = (u) => ({ loginId: u.loginId, studentId: u.studentId, name: u.name, role: u.role });
function studentAttendanceHistory(studentId) {
  const coursesById = new Map(db.courses.map((course) => [course.id, course]));
  return db.sessions
    .filter((session) => session.status === "closed")
    .filter((session) => {
      const course = coursesById.get(session.courseId);
      const roster = session.rosterStudentIds?.length ? session.rosterStudentIds : course?.studentIds || [];
      return roster.includes(studentId);
    })
    .map((session) => {
      const course = coursesById.get(session.courseId);
      const record = db.attendance.find((item) => item.studentId === studentId && item.sessionId === session.code);
      return {
        sessionId: session.code,
        courseId: course.id,
        courseName: course.name,
        courseCode: course.code,
        date: String(session.createdAt || session.closedAt || now()).slice(0, 10),
        status: record?.status || "absent",
        markedAt: record?.markedAt || null,
        note: record?.note || "",
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.sessionId.localeCompare(a.sessionId));
}
const send = (res, status, value, extraHeaders = {}) => {
  const origin = res.requestOrigin;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self)",
    ...(production ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
    ...extraHeaders,
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(value));
};
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
async function body(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 5_000_000) throw fail(413, "BODY_TOO_LARGE", "Request body is too large."); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw fail(400, "INVALID_JSON", "Request body must be valid JSON."); }
}
function tokenUser(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const stored = token && `sha256$${hashToken(token)}`;
  const match = stored && allUsers().find((u) => u.tokens?.some((entry) => entry.digest === stored && Date.parse(entry.expiresAt) > Date.now()));
  if (!match) throw fail(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return match;
}
function assertRole(user, role) { if (user.role !== role) throw fail(403, "FORBIDDEN", "You do not have permission to do that."); }
function courseInput(data, existingId = null) {
  const existing = existingId ? db.courses.find((course) => course.id === existingId) : null;
  const name = String(data.name || "").trim();
  const code = String(data.code || "").trim().toUpperCase();
  const qrTtlSeconds = Number(data.qrTtlSeconds ?? defaultQrTtlSeconds);
  const rawStudentIds = Array.isArray(data.studentIds) ? data.studentIds : (existing?.studentIds || []);
  const studentIds = [...new Set(rawStudentIds.map((id) => String(id).trim().toUpperCase()).filter(Boolean))];
  if (!name || name.length > 100 || !/^[A-Z0-9-]{2,20}$/.test(code)) {
    throw fail(400, "INVALID_COURSE", "Enter a valid course name and code.");
  }
  if (studentIds.length > 500 || studentIds.some((id) => !studentIdPattern.test(id))) throw fail(400, "INVALID_ENROLLMENT", "Enter student roll numbers in YYBCSNNN, YYBDANNN, or YYBECNNN format.");
  if (!Number.isInteger(qrTtlSeconds) || qrTtlSeconds < 5 || qrTtlSeconds > 120) throw fail(400, "INVALID_QR_INTERVAL", "Choose a QR rotation interval between 5 and 120 seconds.");
  if (studentIds.some((id) => !db.users.some((student) => student.role === "student" && student.studentId === id))) throw fail(400, "INVALID_ENROLLMENT", "Every enrolled student must have a provisioned student account.");
  return { name, code, days: [], qrTtlSeconds, beaconId: existing?.beaconId || `Room ${code}`, students: studentIds.length, studentIds };
}
function sessionByCode(code) { const s = db.sessions.find((item) => item.code === code); if (!s) throw fail(404, "SESSION_NOT_FOUND", "Attendance session not found."); return s; }
function ownedSessionByCode(code, user) {
  const session = sessionByCode(code);
  const course = db.courses.find((item) => item.id === session.courseId);
  if (!course || course.professorId !== user.loginId) throw fail(404, "SESSION_NOT_FOUND", "Attendance session not found.");
  return session;
}
function attemptById(id, user) { const a = db.attempts.find((item) => item.attemptId === id && item.studentId === user.studentId); if (!a) throw fail(404, "ATTEMPT_NOT_FOUND", "Attendance attempt not found."); return a; }
function attendanceRoster(session, course) {
  const rosterIds = session.rosterStudentIds?.length ? session.rosterStudentIds : course.studentIds || [];
  return rosterIds.map((studentId) => {
    const student = db.users.find((user) => user.studentId === studentId);
    const record = db.attendance.find((item) => item.studentId === studentId && item.sessionId === session.code);
    return { studentId, name: student?.name || studentId, present: record?.status === "present" || record?.status === "late", status: record?.status || "absent", note: record?.note || "", markedAt: record?.markedAt || null };
  });
}
function courseAttendanceStats(studentId, course) {
  const sessions = db.sessions.filter((session) => session.courseId === course.id && session.status === "closed"
    && (session.rosterStudentIds?.length ? session.rosterStudentIds : course.studentIds || []).includes(studentId));
  const results = sessions.map((session) => db.attendance.find((record) => record.studentId === studentId && record.sessionId === session.code)?.status || "absent");
  const countable = results.filter((status) => status !== "excused");
  const attended = countable.filter((status) => status === "present" || status === "late").length;
  const attendanceRate = countable.length ? Math.round(attended / countable.length * 100) : null;
  return {
    attendanceRate, sessionsHeld: countable.length, attendedSessions: attended,
    excusedSessions: results.length - countable.length,
  };
}
async function callFaceService(pathname, payload) {
  let response;
  try {
    response = await fetch(`${faceServiceUrl}${pathname}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(faceServiceToken ? { Authorization: `Bearer ${faceServiceToken}` } : {}) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw fail(503, "FACE_SERVICE_UNAVAILABLE", "Face verification service is unavailable.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw fail(response.status >= 500 ? 503 : response.status, result.code || "FACE_VERIFICATION_FAILED", result.message || result.detail || "Face verification failed.");
  return result;
}
function activeQr(session) {
  const time = Date.now();
  const course = db.courses.find((item) => item.id === session.courseId);
  const ttlSeconds = course?.qrTtlSeconds ?? defaultQrTtlSeconds;
  if (!session.qr || Date.parse(session.qr.expiresAt) <= time) {
    const issuedAt = new Date(time).toISOString();
    session.qr = { token: randomBytes(24).toString("hex"), issuedAt, expiresAt: new Date(time + ttlSeconds * 1000).toISOString() };
  }
  return { ...session.qr, sessionId: session.code, ttlSeconds };
}

const server = createServer(async (req, res) => {
  res.requestOrigin = req.headers.origin;
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const method = req.method;
    if (method === "GET" && url.pathname === "/api/health") return send(res, 200, { status: "ok", rosterConfigured, accountsProvisioned: allUsers().length > 0 });
    if (method === "GET" && url.pathname === "/api/auth/status") return send(res, 200, {
      passwordLoginEnabled: true,
      studentRegistrationEnabled: !production,
      professorRegistrationEnabled: !production && process.env.ALLOW_SELF_SERVICE_PROFESSOR_REGISTRATION === "true",
    });
    if (method === "POST" && url.pathname === "/api/auth/login") {
      const { loginId, password } = await body(req);
      const rateKey = loginFailureKey(loginId);
      checkLoginRateLimit(rateKey);
      const user = allUsers().find((u) => u.loginId.toUpperCase() === String(loginId || "").trim().toUpperCase());
      const validInput = typeof password === "string" && password.length >= 1 && password.length <= 128;
      const storedHash = user?.passwordHash || dummyPasswordHash;
      const passwordMatches = verifyPassword(validInput ? password : "invalid-password-input", storedHash);
      if (!user || !validInput || !passwordMatches) {
        recordLoginFailure(rateKey);
        throw fail(401, "INVALID_CREDENTIALS", "Invalid ID or password.");
      }
      loginFailureWindows.delete(rateKey);
      if (!storedHash.startsWith("scrypt$")) user.passwordHash = hashPassword(String(password || ""));
      const session = issueSession(user); await save();
      return send(res, 200, { ...session, user: safeUser(user) });
    }
    if (method === "POST" && url.pathname === "/api/auth/password-reset/challenge") {
      const data = await body(req);
      const studentId = String(data.studentId || "").trim().toUpperCase();
      if (!studentIdPattern.test(studentId)) throw fail(400, "INVALID_STUDENT_ID", "Enter a roll number in YYBCSNNN, YYBDANNN, or YYBECNNN format.");
      const rateKey = loginFailureKey(`password-reset:${studentId}`);
      checkLoginRateLimit(rateKey);
      for (const [id, challenge] of passwordResetChallenges) {
        if (challenge.expiresAt <= Date.now()) passwordResetChallenges.delete(id);
      }
      while (passwordResetChallenges.size >= 1000) passwordResetChallenges.delete(passwordResetChallenges.keys().next().value);
      const challengeId = randomBytes(24).toString("hex");
      const challenge = { challengeId, studentId, promptFrame: randomInt(8, 12), expiresAt: Date.now() + 120_000, rateKey };
      passwordResetChallenges.set(challengeId, challenge);
      return send(res, 200, { challengeId, promptFrame: challenge.promptFrame, expiresAt: new Date(challenge.expiresAt).toISOString() });
    }
    if (method === "POST" && url.pathname === "/api/auth/password-reset/complete") {
      const data = await body(req);
      const challengeId = String(data.challengeId || "");
      const challenge = passwordResetChallenges.get(challengeId);
      if (!challenge) throw fail(400, "PASSWORD_RESET_CHALLENGE_INVALID", "Start password recovery again to get a new face check.");
      passwordResetChallenges.delete(challengeId);
      if (challenge.expiresAt <= Date.now()) throw fail(400, "PASSWORD_RESET_CHALLENGE_EXPIRED", "The face check expired. Start password recovery again.");
      const newPassword = String(data.newPassword || "");
      if (newPassword.length < 8 || newPassword.length > 128) throw fail(400, "INVALID_PASSWORD", "Choose a password between 8 and 128 characters.");
      checkLoginRateLimit(challenge.rateKey);
      if (!Array.isArray(data.frames) || data.frames.length < 10 || data.frames.length > 42 || data.frames.some((frame) => typeof frame !== "string" || !frame.startsWith("data:image/jpeg;base64,") || frame.length > 400_000)) {
        throw fail(400, "INVALID_FACE_FRAMES", "The camera capture was incomplete. Please try face verification again.");
      }
      let faceResult;
      try {
        faceResult = await callFaceService("/verify", { studentId: challenge.studentId, frames: data.frames, promptFrame: challenge.promptFrame });
      } catch (verificationError) {
        recordLoginFailure(challenge.rateKey);
        if (verificationError.status === 422) {
          throw fail(422, "FACE_CHECK_UNCLEAR", "We couldn't read the face check. Keep one face centered, keep your eyes open until prompted, then blink once and remain still.");
        }
        if (verificationError.status === 503) {
          throw fail(503, "FACE_SERVICE_UNAVAILABLE", "Face verification is temporarily unavailable. Try again shortly.");
        }
        throw fail(403, "PASSWORD_RESET_VERIFICATION_FAILED", "We could not verify that account. Check the roll number and registered face, then try again.");
      }
      const student = db.users.find((item) => item.role === "student" && item.studentId === challenge.studentId);
      if (!student || faceResult.verified !== true || faceResult.blinkVerified !== true) {
        recordLoginFailure(challenge.rateKey);
        throw fail(403, "PASSWORD_RESET_VERIFICATION_FAILED", "We could not verify that account. Check the roll number and registered face, then try again.");
      }
      student.passwordHash = hashPassword(newPassword);
      student.tokens = [];
      loginFailureWindows.delete(challenge.rateKey);
      await save();
      return send(res, 200, { passwordReset: true });
    }
    if (method === "POST" && url.pathname === "/api/auth/register") {
      const { rollNumber, name, password, faceImage } = await body(req);
      const loginId = String(rollNumber || "").trim().toUpperCase();
      if (!studentIdPattern.test(loginId) || !name?.trim() || typeof password !== "string" || password.length < 8 || password.length > 128) throw fail(400, "INVALID_REGISTRATION", "Enter a roll number in YYBCSNNN, YYBDANNN, or YYBECNNN format, a name, and a password between 8 and 128 characters.");
      if (production) throw fail(403, "STUDENT_PROVISIONING_REQUIRED", "Student accounts must be provisioned after institutional identity verification.");
      if (rosterConfigured && !isOnStudentRoster(loginId)) throw fail(403, "NOT_ON_ROSTER", "This roll number is not eligible for student registration. Contact your administrator if this is an error.");
      if (allUsers().some((u) => u.loginId === loginId)) throw fail(409, "USER_EXISTS", "This student account already exists. Sign in instead.");
      if (!String(faceImage || "").startsWith("data:image/")) throw fail(400, "FACE_IMAGE_REQUIRED", "Capture a face image to enroll your student account.");
      await callFaceService("/enroll", { studentId: loginId, image: faceImage });
      db.users.push({ loginId, studentId: loginId, name: name.trim(), role: "student", passwordHash: hashPassword(password) });
      await save(); return send(res, 201, { user: { loginId, studentId: loginId, name: name.trim(), role: "student" } });
    }
    if (method === "POST" && url.pathname === "/api/auth/register-professor") {
      const { name, email, password } = await body(req);
      const loginId = String(email || "").trim().toLowerCase();
      if (!name?.trim() || name.trim().length > 80 || !/^[^\s@]+@iiitdwd\.ac\.in$/.test(loginId) || !password || password.length < 8 || password.length > 128) {
        throw fail(400, "INVALID_REGISTRATION", "Enter your name, an @iiitdwd.ac.in email address, and a password of at least 8 characters.");
      }
      if (production || process.env.ALLOW_SELF_SERVICE_PROFESSOR_REGISTRATION !== "true") throw fail(403, "PROFESSOR_REGISTRATION_DISABLED", "Professor accounts must be provisioned by an administrator.");
      if (allUsers().some((u) => u.loginId.toLowerCase() === loginId)) throw fail(409, "USER_EXISTS", "An account already exists for this college email.");
      const professor = { loginId, email: loginId, name: name.trim(), role: "professor", passwordHash: hashPassword(password) };
      const session = issueSession(professor); db.usersExtra.push(professor);
      await save(); return send(res, 201, { ...session, user: safeUser(professor) });
    }
    if (method === "POST" && url.pathname === "/api/auth/logout") {
      const user = tokenUser(req);
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      const digest = token && `sha256$${hashToken(token)}`;
      user.tokens = (user.tokens || []).filter((entry) => entry.digest !== digest);
      await save();
      return send(res, 200, { signedOut: true });
    }

    const user = tokenUser(req);
    if (method === "GET" && url.pathname === "/api/teacher/courses") {
      assertRole(user, "professor");
      return send(res, 200, { courses: db.courses.filter((c) => c.professorId === user.loginId).map((c) => ({ ...c, activeSessionCode: db.sessions.find((s) => s.courseId === c.id && s.status === "open")?.code || null })) });
    }
    if (method === "GET" && url.pathname === "/api/teacher/students/range") {
      assertRole(user, "professor");
      const from = String(url.searchParams.get("from") || "").trim().toUpperCase();
      const to = String(url.searchParams.get("to") || "").trim().toUpperCase();
      const fromMatch = from.match(/^(\d{2}(?:BCS|BDA|BEC))(\d{3})$/);
      const toMatch = to.match(/^(\d{2}(?:BCS|BDA|BEC))(\d{3})$/);
      if (!fromMatch || !toMatch || fromMatch[1] !== toMatch[1] || Number(fromMatch[2]) > Number(toMatch[2])) {
        throw fail(400, "INVALID_STUDENT_RANGE", "Enter a valid inclusive roll-number range within the same admission year and department.");
      }
      const minRoll = Number(fromMatch[2]);
      const maxRoll = Number(toMatch[2]);
      const studentIds = db.users
        .filter((student) => student.role === "student" && student.studentId?.startsWith(fromMatch[1]))
        .map((student) => student.studentId)
        .filter((studentId) => Number(studentId.slice(-3)) >= minRoll && Number(studentId.slice(-3)) <= maxRoll)
        .sort((a, b) => Number(a.slice(-3)) - Number(b.slice(-3)));
      return send(res, 200, { from, to, studentIds });
    }
    if (method === "GET" && url.pathname === "/api/teacher/attendance-sessions") {
      assertRole(user, "professor");
      const sessions = db.sessions
        .filter((session) => db.courses.some((course) => course.id === session.courseId && course.professorId === user.loginId))
        .map((session) => {
          const course = db.courses.find((item) => item.id === session.courseId);
          const roster = attendanceRoster(session, course);
          return {
            sessionId: session.code, courseId: course.id, courseName: course.name, courseCode: course.code,
            status: session.status, createdAt: session.createdAt, closedAt: session.closedAt || null,
            totalCount: roster.length,
            presentCount: roster.filter((student) => student.status === "present").length,
            lateCount: roster.filter((student) => student.status === "late").length,
            excusedCount: roster.filter((student) => student.status === "excused").length,
            absentCount: roster.filter((student) => student.status === "absent").length,
          };
        })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return send(res, 200, { sessions });
    }
    if (method === "POST" && url.pathname === "/api/teacher/courses") {
      assertRole(user, "professor"); const data = await body(req); const course = { id: randomUUID(), professorId: user.loginId, ...courseInput(data), createdAt: now() };
      db.courses.push(course); await save(); return send(res, 201, { course });
    }
    let courseMatch = url.pathname.match(/^\/api\/teacher\/courses\/([^/]+)$/);
    if (courseMatch) {
      assertRole(user, "professor"); const id = decodeURIComponent(courseMatch[1]);
      const course = db.courses.find((c) => c.id === id && c.professorId === user.loginId);
      if (!course) throw fail(404, "COURSE_NOT_FOUND", "Class not found in your schedule.");
      if (method === "PUT") {
        if (db.sessions.some((s) => s.courseId === id && s.status === "open")) throw fail(409, "SESSION_OPEN", "Close the live attendance session before editing this class.");
        Object.assign(course, courseInput(await body(req), id)); await save(); return send(res, 200, { course });
      }
      if (method === "DELETE") {
        if (db.sessions.some((s) => s.courseId === id && s.status === "open")) throw fail(409, "SESSION_OPEN", "Close the live attendance session before removing this class.");
        if (db.sessions.some((s) => s.courseId === id) || db.attendance.some((record) => record.courseId === id)) throw fail(409, "CLASS_HAS_HISTORY", "A class with attendance history cannot be removed.");
        db.courses = db.courses.filter((c) => c.id !== id); await save(); return send(res, 200, { deleted: true });
      }
    }
    if (method === "GET" && url.pathname === "/api/student/face") {
      assertRole(user, "student");
      const result = await callFaceService(`/enrolled/${encodeURIComponent(user.studentId)}`);
      return send(res, 200, { enrolled: Boolean(result.enrolled) });
    }
    if (method === "POST" && url.pathname === "/api/student/face") {
      assertRole(user, "student");
      const data = await body(req);
      if (!String(data.faceImage || "").startsWith("data:image/")) throw fail(400, "FACE_IMAGE_REQUIRED", "Capture a face image to enroll your student account.");
      await callFaceService("/enroll", { studentId: user.studentId, image: data.faceImage });
      return send(res, 200, { enrolled: true });
    }
    if (method === "GET" && url.pathname === "/api/student/dashboard") {
      assertRole(user, "student");
      const history = studentAttendanceHistory(user.studentId);
      const today = db.attendance.filter((a) => a.studentId === user.studentId && a.date === new Date().toISOString().slice(0, 10) && (a.status === "present" || a.status === "late"));
      const courses = db.courses.filter((course) => (course.studentIds || []).includes(user.studentId)).map((c) => {
        const attendanceStats = courseAttendanceStats(user.studentId, c);
        const session = db.sessions.find((s) => s.courseId === c.id && s.status === "open");
        const marked = today.some((a) => a.courseId === c.id);
        const professor = allUsers().find((u) => u.loginId === c.professorId);
        return { courseId: c.id, name: c.name, code: c.code, professorName: professor?.name || c.professorId, professorId: c.professorId, activeSessionCode: session?.code || null, marked, canMarkAttendance: Boolean(session && !marked), ...attendanceStats };
      });
      const activeClasses = courses.filter((course) => course.activeSessionCode);
      const completedSessions = history.length;
      const countableSessions = history.filter((entry) => entry.status !== "excused").length;
      const attendedSessions = history.filter((entry) => entry.status === "present" || entry.status === "late").length;
      return send(res, 200, { student: safeUser(user), summary: { overallAttendance: countableSessions ? Math.round((attendedSessions / countableSessions) * 100) : 0, activeSessions: activeClasses.length, presentToday: today.length }, classes: activeClasses, courses });
    }
    if (method === "GET" && url.pathname === "/api/student/attendance-history") {
      assertRole(user, "student");
      return send(res, 200, { history: studentAttendanceHistory(user.studentId) });
    }
    if (method === "POST" && url.pathname === "/api/sessions") {
      assertRole(user, "professor"); const data = await body(req); const course = db.courses.find((c) => c.id === data.courseId && c.professorId === user.loginId);
      if (!course) throw fail(404, "COURSE_NOT_FOUND", "Course not found.");
      if (db.sessions.some((s) => s.courseId === course.id && s.status === "open")) throw fail(409, "SESSION_ALREADY_OPEN", "This course already has an open session.");
      const session = { code: randomBytes(5).toString("hex").toUpperCase(), courseId: course.id, beaconId: data.beaconId || course.beaconId, status: "open", createdAt: now(), qr: null, rosterStudentIds: [...(course.studentIds || [])] };
      db.sessions.push(session); await save(); return send(res, 201, { code: session.code });
    }
    let statusMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/attendance\/([^/]+)$/);
    if (statusMatch && method === "PATCH") {
      assertRole(user, "professor");
      const session = ownedSessionByCode(decodeURIComponent(statusMatch[1]), user);
      if (session.status !== "open") throw fail(409, "SESSION_CLOSED", "Attendance statuses can only be updated while the session is open.");
      const studentId = decodeURIComponent(statusMatch[2]).toUpperCase();
      const student = db.users.find((item) => item.role === "student" && item.studentId === studentId);
      if (!student) throw fail(404, "STUDENT_NOT_FOUND", "No registered student account was found for that roll number.");
      const data = await body(req);
      const status = String(data.status || "").toLowerCase();
      if (!["present", "absent", "late", "excused"].includes(status)) throw fail(400, "INVALID_ATTENDANCE_STATUS", "Choose present or absent.");
      const note = String(data.note || "").trim();
      if (["late", "excused"].includes(status) && !note) throw fail(400, "ATTENDANCE_NOTE_REQUIRED", "Add a note when marking a student late or excused.");
      if (note.length > 500) throw fail(400, "ATTENDANCE_NOTE_TOO_LONG", "Attendance notes must be 500 characters or fewer.");
      const course = db.courses.find((item) => item.id === session.courseId);
      const sessionRoster = session.rosterStudentIds?.length ? session.rosterStudentIds : course.studentIds || [];
      if (status !== "present" && !sessionRoster.includes(studentId)) throw fail(404, "STUDENT_NOT_IN_SESSION", "Student is not on this session roster.");
      const markedAt = now();
      const date = String(session.createdAt || markedAt).slice(0, 10);
      if (!session.rosterStudentIds?.length) session.rosterStudentIds = [...(course.studentIds || [])];
      if (!session.rosterStudentIds.includes(studentId)) session.rosterStudentIds.push(studentId);
      setAttendanceStatus({ studentId, courseId: course.id, sessionId: session.code, markedAt, date, status, note });
      const existing = db.attendance.find((record) => record.studentId === studentId && record.sessionId === session.code);
      if (status === "absent") {
        db.attendance = db.attendance.filter((record) => record.studentId !== studentId || record.sessionId !== session.code);
      } else if (existing) Object.assign(existing, { status, markedAt, date, note, verifiedSteps: existing.verifiedSteps || [] });
      else db.attendance.push({ studentId, courseId: course.id, sessionId: session.code, markedAt, date, status, note, verifiedSteps: [] });
      await save();
      return send(res, 200, { studentId, name: student.name, status, note, markedAt });
    }
    let match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(qr|attendance|close)$/);
    if (match) {
      assertRole(user, "professor"); const session = ownedSessionByCode(decodeURIComponent(match[1]), user);
      if (match[2] === "qr" && method === "GET") { if (session.status !== "open") throw fail(409, "SESSION_CLOSED", "This attendance session is closed."); const qr = activeQr(session); await save(); return send(res, 200, qr); }
      if (match[2] === "attendance" && method === "GET") { const course = db.courses.find((c) => c.id === session.courseId); return send(res, 200, { session: { sessionId: session.code, status: session.status, createdAt: session.createdAt, closedAt: session.closedAt || null }, course: { courseId: course.id, name: course.name, code: course.code }, roster: attendanceRoster(session, course) }); }
      if (match[2] === "close" && method === "POST") { session.status = "closed"; session.closedAt = now(); await save(); return send(res, 200, { status: "closed" }); }
    }
    if (method === "POST" && url.pathname === "/api/attendance/attempts") {
      assertRole(user, "student"); const data = await body(req); const course = db.courses.find((c) => c.id === data.courseId && (c.studentIds || []).includes(user.studentId));
      const session = db.sessions.find((s) => s.courseId === data.courseId && s.status === "open");
      if (!course || !session) throw fail(409, "SESSION_UNAVAILABLE", "There is no open attendance session for this class.");
      if (db.attendance.some((a) => a.studentId === user.studentId && a.courseId === course.id && a.date === new Date().toISOString().slice(0, 10))) throw fail(409, "ALREADY_MARKED", "Attendance is already recorded for this class.");
      const attempt = { attemptId: randomUUID(), studentId: user.studentId, courseId: course.id, sessionId: session.code, requiredFactors: ["qr", "face"], factors: {}, createdAt: now() };
      db.attempts.push(attempt); await save(); return send(res, 201, { attemptId: attempt.attemptId, requiredFactors: attempt.requiredFactors });
    }
    match = url.pathname.match(/^\/api\/attendance\/attempts\/([^/]+)\/(.*)$/);
    if (match) {
      assertRole(user, "student"); const attempt = attemptById(match[1], user); const route = match[2];
      if (route === "ble/challenge" && method === "POST") {
        const session = sessionByCode(attempt.sessionId);
        if (session.status !== "open") throw fail(409, "SESSION_CLOSED", "This attendance session is closed.");
        if (!beaconKeys[session.beaconId]) throw fail(503, "BEACON_NOT_CONFIGURED", "This classroom beacon has not been provisioned on the server.");
        const challenge = { challengeId: randomUUID(), nonce: randomBytes(16).toString("hex"), expiresAt: Date.now() + 30_000 };
        attempt.bleChallenge = challenge; await save();
        return send(res, 200, { challengeId: challenge.challengeId, nonce: challenge.nonce, beaconId: session.beaconId, serviceUuid: bleServiceUuid, challengeUuid: bleChallengeUuid, responseUuid: bleResponseUuid, expiresAt: new Date(challenge.expiresAt).toISOString() });
      }
      if (route === "ble" && method === "POST") {
        const data = await body(req); const session = sessionByCode(attempt.sessionId); const challenge = attempt.bleChallenge;
        if (session.status !== "open") throw fail(409, "SESSION_CLOSED", "This attendance session is closed.");
        if (!challenge || challenge.expiresAt < Date.now() || data.challengeId !== challenge.challengeId) throw fail(400, "BLE_CHALLENGE_INVALID", "The classroom proximity challenge expired. Start the check again.");
        const parts = String(data.proof || "").split("|");
        const keyHex = beaconKeys[session.beaconId];
        if (!keyHex || !/^[a-f0-9]{64}$/i.test(keyHex) || parts.length !== 3 || parts[0] !== session.beaconId || parts[1] !== challenge.nonce || !/^[a-f0-9]{64}$/i.test(parts[2])) throw fail(400, "BLE_CHECK_FAILED", "The connected device did not prove it is the assigned classroom beacon.");
        const expected = createHmac("sha256", Buffer.from(keyHex, "hex")).update(`${challenge.nonce}|${session.beaconId}`).digest();
        const actual = Buffer.from(parts[2], "hex");
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw fail(400, "BLE_CHECK_FAILED", "The classroom beacon response is invalid.");
        delete attempt.bleChallenge; attempt.factors.ble = true; await save(); return send(res, 200, { verified: true });
      }
      if (route === "face/challenge" && method === "POST") {
        if (sessionByCode(attempt.sessionId).status !== "open") throw fail(409, "SESSION_CLOSED", "This attendance session is closed.");
        if (!attempt.factors.qr) throw fail(409, "QR_REQUIRED", "Scan the professor's current QR code before face verification.");
        if (attempt.completedAt) throw fail(409, "ATTEMPT_COMPLETED", "Attendance has already been recorded for this attempt.");
        if (attempt.factors.face) return send(res, 200, { verified: true, alreadyVerified: true });
        const challenge = { challengeId: randomBytes(16).toString("hex"), promptFrame: randomInt(8, 12), expiresAt: Date.now() + 90_000 };
        attempt.challenge = challenge; await save();
        return send(res, 200, { challengeId: challenge.challengeId, promptFrame: challenge.promptFrame, expiresAt: new Date(challenge.expiresAt).toISOString() });
      }
      if (route === "face" && method === "POST") {
        const data = await body(req);
        if (sessionByCode(attempt.sessionId).status !== "open") throw fail(409, "SESSION_CLOSED", "This attendance session is closed.");
        if (!attempt.factors.qr) throw fail(409, "QR_REQUIRED", "Scan the professor's current QR code before face verification.");
        if (attempt.completedAt) throw fail(409, "ATTEMPT_COMPLETED", "Attendance has already been recorded for this attempt.");
        const challenge = attempt.challenge;
        if (!challenge || challenge.expiresAt <= Date.now() || data.challengeId !== challenge.challengeId) throw fail(400, "BLINK_CHALLENGE_INVALID", "The blink check expired. Restart attendance and try again.");
        if (!Array.isArray(data.frames) || data.frames.length < 10 || data.frames.length > 42 || data.frames.some((frame) => typeof frame !== "string" || !frame.startsWith("data:image/jpeg;base64,") || frame.length > 400_000)) throw fail(400, "INVALID_FACE_FRAMES", "The camera capture was incomplete. Please try face verification again.");
        const result = await callFaceService("/verify", { studentId: user.studentId, frames: data.frames, promptFrame: challenge.promptFrame });
        if (result.blinkVerified !== true) throw fail(403, "BLINK_NOT_DETECTED", "Blink once when prompted, then try again.");
        if (result.verified !== true) throw fail(403, "FACE_MISMATCH", "The face does not match the enrolled account.");
        attempt.factors.face = true; attempt.factors.blink = true; delete attempt.challenge; await save(); return send(res, 200, { verified: true, blinkVerified: true });
      }
      if (route === "qr" && method === "POST") {
        const data = await body(req);
        const session = sessionByCode(attempt.sessionId);
        const course = db.courses.find((item) => item.id === attempt.courseId && (item.studentIds || []).includes(user.studentId));
        if (!course) throw fail(403, "NOT_ENROLLED", "You are not enrolled in this class.");
        if (session.status !== "open") throw fail(409, "SESSION_CLOSED", "This attendance session is closed.");
        if (attempt.completedAt) throw fail(409, "ATTEMPT_COMPLETED", "Attendance has already been recorded for this attempt.");
        const qr = activeQr(session);
        if (data.sessionId !== session.code || typeof data.token !== "string" || data.token !== qr.token || Date.parse(qr.expiresAt) <= Date.now()) {
          throw fail(400, "QR_INVALID", "This QR code is invalid or expired. Scan the professor's latest code.");
        }
        attempt.factors.qr = true;
        attempt.qrVerifiedAt = now();
        await save();
        return send(res, 200, { verified: true, sessionId: session.code, courseId: course.id });
      }
      if (route === "complete" && method === "POST") {
        if (attempt.completedAt) throw fail(409, "ALREADY_MARKED", "Attendance has already been recorded for this attempt.");
        if (!attempt.requiredFactors.every((factor) => attempt.factors[factor])) throw fail(409, "FACTORS_INCOMPLETE", "Complete QR and face verification before submitting attendance.");
        const session = sessionByCode(attempt.sessionId);
        const course = db.courses.find((item) => item.id === attempt.courseId && (item.studentIds || []).includes(user.studentId));
        if (!course) throw fail(403, "NOT_ENROLLED", "You are not enrolled in this class.");
        if (session.status !== "open") throw fail(409, "SESSION_CLOSED", "This attendance session is closed.");
        if (db.attendance.some((item) => item.studentId === user.studentId && item.sessionId === session.code)) throw fail(409, "ALREADY_MARKED", "Attendance is already recorded for this session.");
        const record = { studentId: user.studentId, studentName: user.name, courseId: course.id, courseName: course.name, sessionId: session.code, status: "present", verifiedSteps: ["qr", "blink", "face"], markedAt: now(), date: new Date().toISOString().slice(0, 10) };
        if (!completeAttendanceTransaction(record, attempt)) throw fail(409, "ALREADY_MARKED", "Attendance is already recorded for this session.");
        db.attendance.push(record);
        attempt.completedAt = record.markedAt;
        return send(res, 200, record);
      }
    }
    throw fail(404, "NOT_FOUND", "API endpoint not found.");
  } catch (err) {
    console.error(err);
    send(res, err.status || 500, { error: { code: err.code || "INTERNAL_ERROR", message: err.status ? err.message : "The server could not complete the request." } });
  }
});

await load();
if (production && [...db.users, ...db.usersExtra].some((user) => user.demoAccount)) {
  throw new Error("Demo accounts are present in the production database. Remove them and provision institutional accounts before starting.");
}
if (production && [...db.users, ...db.usersExtra].some((user) => !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.test(user.passwordHash || ""))) {
  throw new Error("Every production account must have a valid password hash. Provision password-authenticated accounts before starting.");
}
const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => console.log(`Smart Attendance API listening at http://${host}:${port}`));
