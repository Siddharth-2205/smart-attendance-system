import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "../src/database.js";

if (process.env.NODE_ENV !== "production") {
  console.error("Set NODE_ENV=production before using the production provisioning tool.");
  process.exit(1);
}

const command = process.argv[2];
if (command === "init") {
  if (sql.prepare("SELECT 1 FROM users LIMIT 1").get()) throw new Error("The database already contains accounts; refusing to reinitialize it.");
  sql.prepare("INSERT INTO database_meta(key,value) VALUES('initialized','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  console.log("Initialized empty production SQLite database. Import approved password accounts next.");
  process.exit(0);
}

if (command !== "import" || !process.argv[3]) {
  console.error("Usage: NODE_ENV=production node scripts/provision-users.js init | import <approved-users.json>");
  process.exit(2);
}

const studentRoster = new Set((process.env.STUDENT_ROSTER || "").split(",").map((id) => id.trim().toUpperCase()).filter(Boolean));
const professorRoster = new Set((process.env.PROFESSOR_ROSTER || "").split(",").map((id) => id.trim().toLowerCase()).filter(Boolean));
if (!studentRoster.size || !professorRoster.size) throw new Error("Set exact STUDENT_ROSTER and PROFESSOR_ROSTER allowlists before importing accounts.");
if (sql.prepare("SELECT value FROM database_meta WHERE key='initialized'").get()?.value !== "true") throw new Error("Initialize the production database before importing accounts.");
const rollPattern = /^\d{2}(?:BCS|BDA|BEC)\d{3}$/;
const validPassword = (password) => typeof password === "string" && password.length >= 8 && password.length <= 128;
const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("hex")}`;
};
const approved = JSON.parse(readFileSync(path.resolve(process.argv[3]), "utf8"));
if (!approved || !Array.isArray(approved.students) || !Array.isArray(approved.professors)) throw new Error("Approved user file must contain students and professors arrays.");
const imported = new Set();
const records = [];
for (const record of approved.students) {
  const studentId = String(record.studentId || "").trim().toUpperCase();
  const name = String(record.name || "").trim();
  if (!rollPattern.test(studentId) || !name || name.length > 80 || !validPassword(record.password)) throw new Error("A student record has invalid roll number, name, or password fields.");
  if (!studentRoster.has(studentId)) throw new Error("A student record is not included in the exact student roster.");
  if (imported.has(studentId.toLowerCase())) throw new Error("The approved list contains a duplicate account.");
  imported.add(studentId.toLowerCase());
  records.push({ loginId: studentId, studentId, email: null, name, role: "student", passwordHash: hashPassword(record.password) });
}
for (const record of approved.professors) {
  const loginId = String(record.loginId || "").trim();
  const name = String(record.name || "").trim();
  const key = loginId.toLowerCase();
  if (!loginId || loginId.length > 120 || /\s/.test(loginId) || !name || name.length > 80 || !validPassword(record.password)) throw new Error("A professor record has invalid ID, name, or password fields.");
  if (!professorRoster.has(key)) throw new Error("A professor record is not included in the exact professor roster.");
  if (imported.has(key)) throw new Error("The approved list contains a duplicate account.");
  imported.add(key);
  records.push({ loginId, studentId: null, email: null, name, role: "professor", passwordHash: hashPassword(record.password) });
}

sql.exec("BEGIN IMMEDIATE");
try {
  const put = sql.prepare("INSERT INTO users(login_id,student_id,email,name,role,password_hash,tokens_json,demo_account) VALUES(?,?,?,?,?,?, '[]',0) ON CONFLICT(login_id) DO UPDATE SET name=excluded.name,password_hash=excluded.password_hash,tokens_json='[]'");
  for (const user of records) {
    const existing = sql.prepare("SELECT role,student_id FROM users WHERE login_id=?").get(user.loginId);
    if (existing && (existing.role !== user.role || (user.role === "student" && existing.student_id !== user.studentId))) throw new Error("An account ID already exists under a different role or identity.");
    put.run(user.loginId, user.studentId, user.email, user.name, user.role, user.passwordHash);
  }
  sql.exec("COMMIT");
} catch (error) { sql.exec("ROLLBACK"); throw error; }
console.log(`Created or updated ${records.filter((user) => user.role === "student").length} student and ${records.filter((user) => user.role === "professor").length} professor password accounts.`);
