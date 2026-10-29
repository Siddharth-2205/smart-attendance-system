import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import "../styles/dashboard.css";

function Dashboard({ studentId, onAttendance, onLogout }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [faceEnrolled, setFaceEnrolled] = useState(null);
  const [faceImage, setFaceImage] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    let active = true;
    const refreshDashboard = () => api("/api/student/dashboard")
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err.message); });
    void refreshDashboard();
    const dashboardRefresh = window.setInterval(refreshDashboard, 10_000);
    api("/api/student/face")
      .then((result) => { if (active) setFaceEnrolled(Boolean(result.enrolled)); })
      .catch((err) => { if (active) setError(err.message); });
    api("/api/student/attendance-history")
      .then((result) => { if (active) setHistory(result.history || []); })
      .catch((err) => { if (active) setHistoryError(err.message); });
    return () => {
      active = false;
      window.clearInterval(dashboardRefresh);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const startCamera = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
    } catch {
      setError("Allow camera access to enroll your face.");
    }
  };

  const captureFace = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return setError("Wait for the camera preview, then capture again.");
    const canvas = document.createElement("canvas");
    const width = Math.min(video.videoWidth, 640);
    canvas.width = width;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * width);
    const context = canvas.getContext("2d");
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setFaceImage(canvas.toDataURL("image/jpeg", 0.82));
    setError("");
  };

  const enrollFace = async (event) => {
    event.preventDefault();
    setEnrolling(true);
    setError("");
    try {
      await api("/api/student/face", { method: "POST", body: { faceImage } });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
      setFaceImage("");
      setConsent(false);
      setFaceEnrolled(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <main className="dashboard-page">
      <section className="dashboard-container">
        <header className="dashboard-header">
          <div>
            <h1>Welcome, {data?.student?.name || studentId}</h1>
            <p>Smart Attendance</p>
          </div>
          <div className="student-info">
            <span>Student</span>
            <strong>{data?.student?.studentId || studentId}</strong>
          </div>
        </header>

        {error && <p className="error-message" role="alert">{error}</p>}
        {faceEnrolled === false && (
          <section className="face-enroll-card">
            <h2>Enroll your face</h2>
            <p>Attendance matching needs a face template for this account. Capture one clear image with the laptop camera. Attendance verification compares a new camera image with this encrypted template.</p>
            <form onSubmit={enrollFace}>
              <video ref={videoRef} autoPlay playsInline muted className="register-camera" />
              {!cameraReady ? <button type="button" className="secondary-button" onClick={startCamera}>Enable camera</button> : <button type="button" className="secondary-button" onClick={captureFace}>{faceImage ? "Capture again" : "Capture face"}</button>}
              {faceImage && <p className="face-captured" role="status">Face image captured. Submit to store an encrypted template.</p>}
              <label className="consent-label">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} required />
                I agree to biometric face-template storage for attendance verification.
              </label>
              <button type="submit" disabled={enrolling || !faceImage || !consent}>{enrolling ? "Enrolling…" : "Save face template"}</button>
            </form>
          </section>
        )}
        {faceEnrolled && <p className="face-enrolled-status" role="status">Face template is enrolled for this account.</p>}
        {!data && !error && <p role="status">Loading your dashboard…</p>}
        {data && <>
          <section className="attendance-summary">
            <div className="summary-card"><span>Overall Attendance</span><strong>{data.summary.overallAttendance}%</strong></div>
            <div className="summary-card"><span>Active Sessions</span><strong>{data.summary.activeSessions}</strong></div>
            <div className="summary-card"><span>Present Today</span><strong>{data.summary.presentToday}</strong></div>
          </section>

          <section className="history-section" aria-labelledby="history-heading">
            <div className="history-heading-row">
              <div>
                <h2 id="history-heading">Attendance History</h2>
                <p className="schedule-caption">Your record for completed class sessions.</p>
              </div>
              {history && <span className="history-total">{history.filter((item) => item.status === "present" || item.status === "late").length} of {history.filter((item) => item.status !== "excused").length} counted sessions</span>}
            </div>
            {historyError && <p className="error-message" role="alert">{historyError}</p>}
            {!history && !historyError && <p role="status">Loading attendance history…</p>}
            {history?.length === 0 && <p className="history-empty">No completed class sessions yet. Your attendance will appear here after a session closes.</p>}
            {history?.length > 0 && <div className="history-list">
              {history.map((item) => (
                <article className="history-row" key={item.sessionId}>
                  <div className="history-course">
                    <strong>{item.courseName}</strong>
                    <span>{item.courseCode} · {new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
                  </div>
                  <div className="history-result">
                    <span className={`history-status ${item.status}`}>{item.status === "present" ? "Present" : item.status === "late" ? "Late" : item.status === "excused" ? "Excused" : "Absent"}</span>
                    {item.note && <span className="history-note">{item.note}</span>}
                  </div>
                </article>
              ))}
            </div>}
          </section>

          <section className="classes-section">
            <h2>Active Attendance Sessions</h2>
            <p className="schedule-caption">Only sessions currently switched on by a professor appear here.</p>
            <div className="class-list">
              {data.classes.map((course) => (
                <article className="class-card" key={course.courseId}>
                  <div>
                    <h3>{course.name}</h3>
                    <p>{course.code} · Attendance is active</p>
                    <p>Professor: {course.professorName}</p>
                    {course.marked && <p>Attendance already recorded.</p>}
                    {!course.activeSessionCode && <p>Attendance session is not open yet.</p>}
                  </div>
                  <button
                    disabled={course.marked || faceEnrolled !== true}
                    onClick={() => onAttendance(course)}
                  >
                    {course.marked ? "Marked" : faceEnrolled !== true ? "Enroll face first" : "Mark Attendance"}
                  </button>
                </article>
              ))}
              {data.classes.length === 0 && <p>No active attendance sessions right now. Classes will appear here when a professor switches attendance on.</p>}
            </div>
          </section>
        </>}
        <footer className="student-dashboard-footer">
          <button type="button" onClick={onLogout}>Logout</button>
        </footer>
      </section>
    </main>
  );
}

export default Dashboard;
