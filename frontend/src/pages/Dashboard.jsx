import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import "../styles/dashboard.css";

function Dashboard({ studentId, onAttendance }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [faceEnrolled, setFaceEnrolled] = useState(null);
  const [faceImage, setFaceImage] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    let active = true;
    api("/api/student/dashboard")
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err.message); });
    api("/api/student/face")
      .then((result) => { if (active) setFaceEnrolled(Boolean(result.enrolled)); })
      .catch((err) => { if (active) setError(err.message); });
    return () => {
      active = false;
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
            <div className="summary-card"><span>Classes Today</span><strong>{data.summary.classesToday}</strong></div>
            <div className="summary-card"><span>Present Today</span><strong>{data.summary.presentToday} / {data.summary.classesToday}</strong></div>
          </section>

          <section className="classes-section">
            <h2>Weekly Class Schedule</h2>
            <p className="schedule-caption">Class times and professor details are set by each professor.</p>
            <div className="class-list">
              {data.classes.map((course) => (
                <article className="class-card" key={course.courseId}>
                  <div>
                    <h3>{course.name}</h3>
                    <p>{course.code} · {(course.days || []).join(", ")} · {course.timeLabel}</p>
                    <p>Professor: {course.professorName}</p>
                    <p>Room: {course.beaconId}</p>
                    {course.marked && <p>Attendance already recorded.</p>}
                    {!course.activeSessionCode && <p>Attendance session is not open yet.</p>}
                  </div>
                  <button
                    disabled={!course.canMarkAttendance || faceEnrolled !== true}
                    onClick={() => onAttendance(course)}
                  >
                    {course.marked ? "Marked" : faceEnrolled !== true ? "Enroll face first" : course.canMarkAttendance ? "Mark Attendance" : "Not available"}
                  </button>
                </article>
              ))}
              {data.classes.length === 0 && <p>No classes are scheduled for today.</p>}
            </div>
          </section>
        </>}
      </section>
    </main>
  );
}

export default Dashboard;
