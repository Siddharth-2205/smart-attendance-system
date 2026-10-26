# Smart Attendance API

The Node.js API authenticates students and professors with account ID and password, manages rotating QR sessions, validates face-service results, and records attendance. SQLite is the canonical store for accounts, classes, enrollments, sessions, verification attempts, and attendance. Ordered transactional migrations are applied from `src/database.js`; the legacy `store.json` is imported once when needed and is no longer used afterward. Attendance records have a unique student/session constraint and foreign keys.

Student IDs use eight characters: two admission-year digits, `BCS` (CSE), `BDA` (DSAI), or `BEC` (ECE), and a three-digit roll number. Example: `25BCS090`.

## Run locally

Use the repository startup scripts from PowerShell:

```powershell
cd backend
.\start.ps1
```

In separate terminals, start the face service and HTTPS frontend following their setup guides: [face-liveness](../face-liveness/README.md) and [frontend](../frontend/README.md). The local frontend is served at `https://localhost:5174` and proxies `/api` to the backend on port 4000. Use HTTPS for browser camera access.

On a clean development database, the backend creates local demo accounts. Do not use development accounts or the broad local registration range outside local testing. The `backend/start.ps1` script sets `STUDENT_ROSTER_RANGE=001-300` for the requested laptop workflow. Production requires an exact institutional roster.

Student registration is restricted by the configured roster and requires a face enrollment image. Professor self-registration is disabled unless `ALLOW_SELF_SERVICE_PROFESSOR_REGISTRATION=true`; production always disables self-registration. Login always goes through the backend and verifies the stored password hash. Passwords are not returned to the frontend. Password hashes use per-account random salts; bearer tokens are stored as SHA-256 digests and expire after eight hours by default.

## Attendance flow

Student login -> Dynamic QR verification -> Face verification -> Backend attendance recording -> Attendance success.

- `POST /api/auth/login` authenticates a student roll number or professor ID/email and password.
- `GET /api/auth/status` returns whether student or professor self-registration is enabled for this environment.
- `POST /api/auth/logout` revokes the active bearer token.
- `POST /api/attendance/attempts` starts a student-bound attempt for an active class session.
- `GET /api/sessions/:code/qr` returns the server-generated rotating QR token.
- `POST /api/attendance/attempts/:id/qr` validates the current QR against the active session.
- `POST /api/attendance/attempts/:id/face` sends one camera image to the local face service for comparison with the student's encrypted enrollment, after QR verification. This is face matching only and does not detect liveness or photo/video spoofing.
- `POST /api/attendance/attempts/:id/complete` records attendance only after required checks pass.
- `POST /api/sessions/:code/close` ends a professor's session.

BLE is not part of the student attendance progression. The scanner and face-verification implementations are documented in the frontend and face-service guides.

## Production account provisioning

Production requires `NODE_ENV=production`, an exact `STUDENT_ROSTER`, an exact `PROFESSOR_ROSTER`, HTTPS-only `CORS_ORIGINS`, and an initialized database. Production rejects demo accounts and any account without a valid password hash. Student and professor registration remain disabled; the backend login route still requires a valid ID and password.

Create a private JSON file outside the repository with institution-approved accounts and initial passwords:

```json
{
  "students": [{ "studentId": "25BCS090", "name": "Student Name", "password": "set-a-private-initial-password" }],
  "professors": [{ "loginId": "faculty-id", "name": "Professor Name", "password": "set-a-private-initial-password" }]
}
```

Set exact allowlists and `DATA_DIR`, stop the API, then run these commands from `backend`:

```powershell
$env:NODE_ENV = "production"
$env:STUDENT_ROSTER = "25BCS090"
$env:PROFESSOR_ROSTER = "faculty-id"
$env:DATA_DIR = "C:\secure-data\attendance"
node .\scripts\provision-users.js init
node .\scripts\provision-users.js import C:\secure-data\approved-users.json
```

For an already initialized database, skip `init` and run `import` only. Include every existing account that needs a password; importing an existing ID preserves its role and student ID, updates its password hash, and revokes its old sessions. The import validates accounts against the exact rosters and stores salted password hashes. Keep the input file private and remove it after provisioning. The API does not load `.env` files automatically; configure runtime variables in the hosting environment or secret manager.

The API creates the relational SQLite schema and records its migration version when it first opens the database. When upgrading an existing laptop database, stop the old API and make a backup of `backend/data/attendance.sqlite` (and `store.json`, if present), then start the new API. Its transactional migration imports the previous SQLite state, or the JSON file only if no SQLite state exists. It leaves the old JSON file in place as an archival copy; subsequent reads and writes use SQLite only. See [database storage](../database/README.md) for the schema and backup notes.

## Environment variables

- `HOST` and `PORT` configure the API listener (`0.0.0.0` and `4000` in the local script).
- `DATA_DIR` selects the SQLite database directory.
- `STUDENT_ROSTER` is the exact comma-separated production student allowlist.
- `STUDENT_ROSTER_RANGE` is for local development only; production rejects it.
- `PROFESSOR_ROSTER` is the exact comma-separated allowlist used by the production provisioning script.
- `CORS_ORIGINS` is a comma-separated list of allowed frontend origins. Production requires HTTPS origins.
- `FACE_SERVICE_URL` configures the private face-service endpoint.
- `QR_TTL_SECONDS` configures the QR rotation interval (30 seconds by default).
- `SESSION_TTL_SECONDS` configures session lifetime (eight hours by default, bounded to 10 minutes through 24 hours).
- `ALLOW_SELF_SERVICE_PROFESSOR_REGISTRATION` enables professor registration only in local development.

There are no Google OAuth credentials, callbacks, or OAuth routes in this version.

## Production limitations

This repository still needs deployment-specific security and operations work before production use: HTTPS reverse proxy and rate limiting, private authenticated access between the backend and face service, database backup/restore validation, and stronger biometric presentation-attack detection. The current face action checks are a prototype, not certified anti-spoofing.

Run backend tests with `npm.cmd test` from `backend`. Run frontend checks with `npm.cmd run lint` and `npm.cmd run build` from `frontend`.
