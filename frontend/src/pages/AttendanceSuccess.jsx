import "../styles/attendance-success.css";

function AttendanceSuccess({ className }) {
  return (
    <main className="success-page">
      <section className="success-card">

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
            <strong>{className}</strong>
          </div>

          <div>
            <span>Status</span>
            <strong>Present</strong>
          </div>

        </div>

        {/* Verification Summary */}
        <div className="success-verification">

          <p>
            ✓ &nbsp; BLE proximity verified
          </p>

          <p>
            ✓ &nbsp; Face liveness verified
          </p>

          <p>
            ✓ &nbsp; Attendance recorded
          </p>

        </div>

        {/* Footer Message */}
        <p className="success-note">
          Your physical presence was verified using BLE proximity
          and face liveness detection.
        </p>

      </section>
    </main>
  );
}

export default AttendanceSuccess;


