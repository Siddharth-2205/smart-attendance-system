import { useEffect, useRef, useState } from "react";
import { api, login, logout } from "../api";
import "../styles/login.css";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function Login({ onLogin, initialError = "" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [registering, setRegistering] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [faceImage, setFaceImage] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(true);
  const [resetChallenge, setResetChallenge] = useState(null);
  const [resetStage, setResetStage] = useState("ready");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  useEffect(() => {
    let mounted = true;
    api("/api/auth/status").then((status) => {
      if (mounted) setRegistrationEnabled(status.studentRegistrationEnabled);
      if (mounted) setPasswordLoginEnabled(status.passwordLoginEnabled);
    }).catch(() => { if (mounted) setRegistrationEnabled(false); });
    return () => { mounted = false; };
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  };

  const startCamera = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
    } catch {
      setError("Allow camera access to verify your face.");
    }
  };

  useEffect(() => {
    if (forgotPassword && resetChallenge && !cameraReady) void startCamera();
  }, [forgotPassword, resetChallenge, cameraReady]);

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

  const captureResetFrames = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) throw new Error("Wait for the camera preview, then try again.");
    const frames = [];
    const canvas = document.createElement("canvas");
    const width = Math.min(video.videoWidth, 480);
    if (!width || !video.videoHeight) throw new Error("The camera preview is still loading. Try again in a moment.");
    canvas.width = width;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * width);
    const context = canvas.getContext("2d");
    for (let index = 0; index < 42; index += 1) {
      await sleep(70);
      if (index >= resetChallenge.promptFrame) setResetStage("blink");
      context.setTransform(-1, 0, 0, 1, canvas.width, 0);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.48));
    }
    setResetStage("checking");
    return frames;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
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

  const beginForgotPassword = () => {
    setForgotPassword(true);
    setRegistering(false);
    setStudentId((value) => value.trim().toUpperCase());
    setResetChallenge(null);
    setResetStage("ready");
    setNewPassword("");
    setConfirmNewPassword("");
    setError("");
    setNotice("");
  };

  const cancelForgotPassword = () => {
    setForgotPassword(false);
    setResetChallenge(null);
    setResetStage("ready");
    setNewPassword("");
    setConfirmNewPassword("");
    setError("");
    stopCamera();
  };

  const requestResetChallenge = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const roll = studentId.trim().toUpperCase();
      const challenge = await api("/api/auth/password-reset/challenge", { method: "POST", body: { studentId: roll } });
      setStudentId(roll);
      setResetChallenge(challenge);
      setResetStage("ready");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const completePasswordReset = async (event) => {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8 || newPassword.length > 128) return setError("Choose a password between 8 and 128 characters.");
    if (newPassword !== confirmNewPassword) return setError("The passwords do not match.");
    setSubmitting(true);
    try {
      const frames = await captureResetFrames();
      await api("/api/auth/password-reset/complete", {
        method: "POST",
        body: { challengeId: resetChallenge.challengeId, frames, newPassword },
      });
      stopCamera();
      setForgotPassword(false);
      setResetChallenge(null);
      setResetStage("ready");
      setPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setNotice("Password changed. Sign in with your new password.");
    } catch (err) {
      setResetChallenge(null);
      setResetStage("ready");
      stopCamera();
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setRegistering((value) => !value);
    setError("");
    setNotice("");
    setFaceImage("");
    stopCamera();
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-header">
          {forgotPassword
            ? <span className="login-step-label">STUDENT ACCOUNT RECOVERY</span>
            : null}
          <h1>Smart Attendance</h1>
          <p>{forgotPassword ? "Verify your registered face to reset your password" : registering ? "Create your student account" : "Secure attendance for IIIT Dharwad"}</p>
        </div>

        {forgotPassword && passwordLoginEnabled && <>
          {!resetChallenge ? <form className="login-form" onSubmit={requestResetChallenge}>
            <label htmlFor="resetStudentId">Roll number</label>
            <input id="resetStudentId" type="text" value={studentId} onChange={(event) => setStudentId(event.target.value.toUpperCase())} placeholder="25BCS090" autoComplete="username" pattern="[0-9]{2}(BCS|BDA|BEC)[0-9]{3}" title="Use YYBCSNNN, YYBDANNN, or YYBECNNN." required maxLength={8} />
            <p className="login-info compact">We’ll check the roll number against the face registered to that account.</p>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button type="submit" disabled={submitting}>{submitting ? "Please wait…" : "Continue to face check"}</button>
          </form> : <form className="login-form" onSubmit={completePasswordReset}>
            <label htmlFor="resetStudentIdReadonly">Roll number</label>
            <input id="resetStudentIdReadonly" value={studentId} readOnly />
            <label>Face verification</label>
            <div className="reset-camera-wrap">
              <video ref={videoRef} autoPlay playsInline muted className="register-camera" />
              {resetStage === "blink" && <span className="blink-prompt">Blink now</span>}
            </div>
            {!cameraReady && <button type="button" className="secondary-button" onClick={startCamera}>Enable camera</button>}
            <p className="login-info compact" aria-live="polite">
              {resetStage === "checking" ? "Checking your registered face…" : resetStage === "blink" ? "Blink once now to confirm you’re present." : "Center your face. The camera will check your face and prompt you to blink."}
            </p>
            <label htmlFor="newStudentPassword">New password</label>
            <input id="newStudentPassword" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required minLength={8} maxLength={128} />
            <label htmlFor="confirmStudentPassword">Confirm new password</label>
            <input id="confirmStudentPassword" type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="Re-enter your password" autoComplete="new-password" required minLength={8} maxLength={128} />
            {error && <p className="error-message" role="alert">{error}</p>}
            <button type="submit" disabled={submitting || !cameraReady}>{submitting ? resetStage === "checking" ? "Verifying face…" : "Preparing face check…" : "Verify face and reset password"}</button>
          </form>}
        </>}

        {!forgotPassword && passwordLoginEnabled && <form className="login-form" onSubmit={handleSubmit}>
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
            <p className="login-info compact">Your roll number must use the supported student format. When an institutional roster is configured, registration is limited to that roster.</p>
          </>}

          {!registering && <>
            <label htmlFor="studentPassword">Password</label>
            <input id="studentPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
          </>}
          {error && <p className="error-message" role="alert">{error}</p>}
          {registering && !registrationEnabled && <p className="login-info" role="status">New student accounts must be enabled by an administrator in this environment.</p>}
          <button type="submit" disabled={submitting || (registering && (!registrationEnabled || !faceImage || !consent))}>
            {submitting ? "Please wait…" : registering ? "Create account" : "Sign in"}
          </button>
        </form>}
        {notice && !forgotPassword && <p className="login-success" role="status">{notice}</p>}
        <div className="login-secondary-actions">
          {forgotPassword
            ? <button type="button" className="mode-switch" onClick={cancelForgotPassword}>Back to sign in</button>
            : <>
              <button type="button" className="mode-switch" onClick={switchMode}>
                {registering ? "Already registered? Sign in" : "New student? Register with your face"}
              </button>
              {!registering && passwordLoginEnabled && <button type="button" className="mode-switch" onClick={beginForgotPassword}>Forgot password?</button>}
            </>}
        </div>
        {!registering && !forgotPassword && passwordLoginEnabled && <p className="login-info">Sign in with the student ID and password issued to you.</p>}
      </section>
    </main>
  );
}

export default Login;
