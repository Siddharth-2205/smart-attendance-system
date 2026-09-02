import "../styles/attendance-success.css";

function AttendanceSuccess({ className }) {
  return (
    <main className="success-page">
      <section className="success-card">

        <div className="success-check">
          ✓
        </div>

        <h1>Attendance Marked!</h1>

        <p className="success-message">
          Your attendance has been successfully recorded.
        </p>

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

        <p className="success-note">
          BLE proximity and face liveness verification
          completed successfully.
        </p>

      </section>
    </main>
  );
}

export default AttendanceSuccess;


