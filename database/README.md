# Database storage

The local attendance API uses SQLite at `backend/data/attendance.sqlite` by default. Set `DATA_DIR` to choose another persistent directory. SQLite is the single canonical store for accounts, class records and enrollments, attendance sessions and rotating QR state, verification attempts, and attendance records. The old `store.json` is no longer written or read after database migration.

## Schema and migrations

The backend applies ordered, transactional schema migrations from `backend/src/database.js` when it opens the database. Applied versions are recorded in `schema_migrations`.

The current schema includes:

- `users`: student and professor accounts, salted password hashes, and hashed-token metadata.
- `courses` and `course_enrollments`: class schedule and normalized student enrollment.
- `attendance_sessions`: active/closed class sessions and the server-controlled rotating QR token.
- `attendance_attempts`: student-bound QR/face verification progress and completion state.
- `attendance_records`: confirmed attendance with unique `(student_id, session_id)` and foreign-key relationships.

Foreign-key enforcement is enabled on every backend connection. The migration imports the previous `app_state`, `courses`, and `attendance_records` SQLite layout. If no SQLite state exists, a local development migration can import `store.json` once. The source JSON is retained as an archival file but is not subsequently consulted. Failed migrations roll back as a unit; take a backup before starting the updated backend against important data.

## Backups

Stop the backend before copying `attendance.sqlite` for a simple local backup. Keep backups outside the repository and verify that a backup can be restored before relying on it. Face templates are stored separately by the face service under its configured `FACE_DATA_DIR`.
