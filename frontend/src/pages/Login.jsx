import { useEffect, useRef, useState } from "react";
import { api, login, logout } from "../api";
import "../styles/login.css";

function Login({ onLogin, initialError = "" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [registering, setRegistering] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [faceImage, setFaceImage] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(true);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  useEffect(() => {
    let mounted = true;
    api("/api/auth/status").then((status) => {
      if (mounted) setRegistrationEnabled(status.studentRegistrationEnabled);
      if (mounted) setPasswordLoginEnabled(status.passwordLoginEnabled);
    }).catch(() => { if (mounted) setRegistrationEnabled(false); });
    return () => { mounted = false; };
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
      setError("Allow camera access to register your face.");
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (registering) {
        const result = await api("/api/auth/register", {
          method: "POST",
          body: { rollNumber: studentId, name, password, faceImage },
        });
        const user = await login(result.user.loginId, password);
        onLogin(user);
      } else {
        const user = await login(studentId.trim(), password);
        if (user.role !== "student") {
          logout();
          throw new Error("This account is for the professor portal.");
        }
        onLogin(user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setRegistering((value) => !value);
    setError("");
    setFaceImage("");
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-header">
          {!registering && <span className="login-step-label">STEP 1 OF 4 · STUDENT LOGIN</span>}
          <h1>Smart Attendance</h1>
          <p>{registering ? "Create your student account" : "Secure attendance for IIIT Dharwad"}</p>
        </div>

        {passwordLoginEnabled && <form className="login-form" onSubmit={handleSubmit}>
          {registering && <>
            <label htmlFor="studentName">Full name</label>
            <input id="studentName" value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" autoComplete="name" required maxLength={80} />
          </>}
          <label htmlFor="studentId">Roll number</label>
          <input id="studentId" type="text" value={studentId} onChange={(event) => setStudentId(event.target.value.toUpperCase())} placeholder="25BCS090" autoComplete="username" pattern="[0-9]{2}(BCS|BDA|BEC)[0-9]{3}" title="Use YYBCSNNN, YYBDANNN, or YYBECNNN; the final three digits range from 000 to 999." required maxLength={8} />

          {registering && <>
            <label htmlFor="facePassword">Password</label>
            <input id="facePassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required minLength={8} maxLength={128} />
            <label>Face enrollment</label>
            <video ref={videoRef} autoPlay playsInline muted className="register-camera" />
            {!cameraReady ? <button type="button" className="secondary-button" onClick={startCamera}>Enable camera</button> : <button type="button" className="secondary-button" onClick={captureFace}>{faceImage ? "Capture again" : "Capture face"}</button>}
            {faceImage && <p className="face-captured" role="status">Face image captured. The server will validate it before creating your account.</p>}
            <label className="consent-label">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
              I agree to biometric face-template storage for attendance verification.
            </label>
            <p className="login-info compact">The original enrollment image is processed locally; the service stores a face template for matching. Registration checks the configured student allowlist.</p>
          </>}

          {!registering && <>
            <label htmlFor="studentPassword">Password</label>
            <input id="studentPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
          </>}
          {error && <p className="error-message" role="alert">{error}</p>}
          <button type="submit" disabled={submitting || (registering && (!faceImage || !consent))}>
            {submitting ? "Please wait…" : registering ? "Create account" : "Sign in"}
          </button>
        </form>}
        {registrationEnabled && <button type="button" className="mode-switch" onClick={switchMode}>
          {registering ? "Already registered? Sign in" : "New student? Register with your face"}
        </button>}
        {!registering && passwordLoginEnabled && <p className="login-info">Sign in with the student ID and password issued to you.</p>}
      </section>
    </main>
  );
}

export default Login;
