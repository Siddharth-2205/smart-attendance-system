import "../styles/attendance-success.css";

function AttendanceSuccess({ attendance, onReturn }) {
  if (!attendance?.markedAt || attendance.status !== "present") return null;
  return (
    <main className="success-page">
      <section className="success-card">
        <p className="success-step">STEP 4 OF 4 · ATTENDANCE SUCCESS</p>

        {/* Success Icon */}
        <div className="success-check">
          ✓
        </div>

        {/* Heading */}
        <h1>Attendance Marked!</h1>

        <p className="success-message">
          Your attendance has been successfully recorded.
        </p>

        {/* Attendance Details */}
        <div className="attendance-details">
          <div>
            <span>Class</span>
            <strong>{attendance.courseName}</strong>
          </div>

          <div>
            <span>Status</span>
            <strong>Present</strong>
          </div>

          {attendance.studentId && (
            <div>
              <span>Student ID</span>
              <strong>{attendance.studentId}</strong>
            </div>
          )}
          <div>
            <span>Recorded at</span>
            <strong>{new Date(attendance.markedAt).toLocaleString()}</strong>
          </div>
        </div>

        {/* Verification Summary */}
        <div className="success-verification">
          {attendance.verifiedSteps?.includes("qr") && <p>[OK] Dynamic QR validated</p>}
          {attendance.verifiedSteps?.includes("blink") && <p>[OK] Blink prompt passed</p>}
          {attendance.verifiedSteps?.includes("face") && <p>[OK] Enrolled face match passed</p>}
          <p>[OK] Attendance recorded by the server</p>
        </div>

        {/* Footer Message */}
        <p className="success-note">
          Your attendance and the required verification checks were confirmed by the server.
        </p>
      <button type="button" className="success-button" onClick={onReturn}>Return to dashboard</button>

      </section>
    </main>
  );
}

export default AttendanceSuccess;
