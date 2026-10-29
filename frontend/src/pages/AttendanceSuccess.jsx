import "../styles/attendance-success.css";
import Confetti from "../components/Confetti";
import { useEffect, useRef } from "react";

function AttendanceSuccess({ attendance, onReturn }) {
  const confettiRef = useRef(null);

  useEffect(() => {
    if (!attendance?.markedAt || attendance.status !== "present") return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    let secondBurst;
    let thirdBurst;
    const firstFrame = window.requestAnimationFrame(() => {
      void confettiRef.current?.fire();
      secondBurst = window.setTimeout(() => {
        void confettiRef.current?.fire({ particleCount: 90, spread: 105, startVelocity: 34, origin: { x: 0.18, y: 0.72 } });
      }, 220);
      thirdBurst = window.setTimeout(() => {
        void confettiRef.current?.fire({ particleCount: 90, spread: 105, startVelocity: 34, origin: { x: 0.82, y: 0.72 } });
      }, 440);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.clearTimeout(secondBurst);
      window.clearTimeout(thirdBurst);
    };
  }, [attendance?.markedAt, attendance?.status]);

  if (!attendance?.markedAt || attendance.status !== "present") return null;
  return (
    <main className="success-page">
      <Confetti
        ref={confettiRef}
        className="success-confetti-canvas"
        aria-hidden="true"
        options={{ particleCount: 120, spread: 76, startVelocity: 38, origin: { y: 0.62 } }}
        manualstart
      />
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
