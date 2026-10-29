import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import "../styles/face-liveness.css";

function FaceLiveness({ className, attemptId, onVerified }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const hasCompletedRef = useRef(false);
  const inFlightRef = useRef(false);

  const [hasCompleted, setHasCompleted] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("requesting");
  const [verificationStatus, setVerificationStatus] = useState("ready");
  const [verificationStage, setVerificationStage] = useState("positioning");
  const [error, setError] = useState("");

  // ==========================================
  // START CAMERA
  // ==========================================

  useEffect(() => {
    let stream;
    let mounted = true;

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera API is not supported.");
        }

        const cameraStream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
            },
            audio: false,
          });

        // Stop the stream if the component has already unmounted.
        if (!mounted) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = cameraStream;
        const video = videoRef.current;
        if (!video) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = cameraStream;
        try {
          await video.play();
        } catch (playError) {
          if (!mounted) return;
          throw playError;
        }

        if (mounted) setCameraStatus("ready");
      } catch (err) {
        if (!mounted) return;
        if (stream) {
          const video = videoRef.current;
          if (video?.srcObject === stream) video.srcObject = null;
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
        console.error("Camera access error:", err);

        if (mounted) {
          setCameraStatus("error");
          setError(err.name === "AbortError"
            ? "The camera preview was interrupted. Please restart camera access and try again."
            : "Camera access is required for face verification. Please allow camera permissions and try again.");
        }
      }
    };

    startCamera();

    return () => {
      mounted = false;

      // Stop camera tracks when leaving the page.
      if (stream) {
        const video = videoRef.current;
        if (video?.srcObject === stream) {
          video.pause();
          video.srcObject = null;
        }
        stream.getTracks().forEach((track) => track.stop());
      }

    };
  }, []);

  // ==========================================
  // START FACE VERIFICATION
  // ==========================================

  const startFaceVerification = async () => {
    if (
      cameraStatus !== "ready" ||
      verificationStatus !== "ready" ||
      hasCompletedRef.current ||
      inFlightRef.current
    ) {
      return;
    }

    inFlightRef.current = true;
    setVerificationStatus("verifying");
    setVerificationStage("positioning");
    setError("");

    try {
      const challenge = await api(`/api/attendance/attempts/${attemptId}/face/challenge`, { method: "POST" });
      if (challenge.alreadyVerified) {
        if (typeof onVerified === "function") await onVerified();
        hasCompletedRef.current = true;
        setHasCompleted(true);
        setVerificationStatus("verified");
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2) throw new Error("Camera is not ready. Please try again.");
      const canvas = canvasRef.current;
      const width = Math.min(video.videoWidth, 400);
      if (!width || !video.videoHeight) throw new Error("Camera is not ready. Please try again.");
      const height = Math.round((video.videoHeight / video.videoWidth) * width);
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      const frames = [];
      // Capture a short sequence. The server samples every other frame and
      // compares three post-blink images, so extra adjacent frames add latency
      // and upload size without improving the check.
      for (let index = 0; index < 40; index += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 60));
        if (index >= challenge.promptFrame) setVerificationStage("blink");
        context.save();
        context.translate(width, 0);
        context.scale(-1, 1);
        context.drawImage(video, 0, 0, width, height);
        context.restore();
        frames.push(canvas.toDataURL("image/jpeg", 0.5));
      }
      setVerificationStage("checking");
      await api(`/api/attendance/attempts/${attemptId}/face`, {
        method: "POST",
        body: { challengeId: challenge.challengeId, frames },
      });
      if (typeof onVerified === "function") await onVerified();
      hasCompletedRef.current = true;
      setHasCompleted(true);
      setVerificationStatus("verified");
    } catch (err) {
      setError(err.message);
      setVerificationStatus("ready");
    } finally {
      inFlightRef.current = false;
    }
  };

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <main className={`face-page ${className || ""}`}>
      <section className="face-card">

        {/* HEADER */}

        <header className="face-header">
          <div className="face-header-top">

            <div className="face-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M4 8V6C4 4.9 4.9 4 6 4H8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <path
                  d="M16 4H18C19.1 4 20 4.9 20 6V8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <path
                  d="M20 16V18C20 19.1 19.1 20 18 20H16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <path
                  d="M8 20H6C4.9 20 4 19.1 4 18V16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />

                <circle
                  cx="12"
                  cy="10"
                  r="2.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />

                <path
                  d="M7.5 17C8.5 14.8 10 14 12 14C14 14 15.5 14.8 16.5 17"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div>
              <span className="face-eyebrow">
                STEP 3 OF 4
              </span>

              <h1>Verify Your Identity</h1>

              <p>
                Look at the camera to compare your face with your enrollment.
              </p>
            </div>

          </div>
        </header>

        {/* CAMERA */}

        <div
          className={`camera-container ${
            verificationStatus === "verifying"
              ? "verifying"
              : ""
          } ${
            verificationStatus === "verified"
              ? "verified"
              : ""
          }`}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            className="camera-preview"
          />
          <canvas ref={canvasRef} hidden />

          {/* Camera loading */}

          {cameraStatus === "requesting" && (
            <div className="camera-message">
              <div className="camera-loader"></div>

              <strong>
                Requesting camera access
              </strong>

              <span>
                Please allow camera access to continue.
              </span>
            </div>
          )}

          {/* Camera error */}

          {cameraStatus === "error" && (
            <div className="camera-message error">
              <div className="camera-error-icon">
                !
              </div>

              <strong>
                Camera unavailable
              </strong>

              <span>
                {error}
              </span>
            </div>
          )}

          {/* Face scanning animation */}

          {verificationStatus === "verifying" && (
            <>
              <div className="face-frame">
                <span className="frame-corner top-left"></span>
                <span className="frame-corner top-right"></span>
                <span className="frame-corner bottom-left"></span>
                <span className="frame-corner bottom-right"></span>

                <div className="face-scan-line"></div>
              </div>

              <div className="face-position-label">
                Keep your face centered
              </div>
            </>
          )}

          {/* Verification success overlay */}

          {verificationStatus === "verified" && (
            <div className="verification-overlay">
              <div className="success-icon">
                ✓
              </div>

              <strong>
                  Blink and Face Match Verified
              </strong>

              <span>
                Identity check successful
              </span>
            </div>
          )}
        </div>

        {/* READY STATE */}

        {verificationStatus === "ready" && (
          <>
            <div className="face-status ready">
              <div className="status-dot"></div>

              <div>
                <strong>
                  Ready for verification
                </strong>

                <span>
                    Blink once when prompted. We will compare your face with its enrollment.
                </span>
              </div>
            </div>

            <div className="face-instructions">

              <div className="instruction-item">
                <span className="instruction-check">
                  ✓
                </span>

                <div>
                  <strong>
                    Face clearly visible
                  </strong>

                  <span>
                    Make sure your face is not covered.
                  </span>
                </div>
              </div>

              <div className="instruction-item">
                <span className="instruction-check">
                  ✓
                </span>

                <div>
                  <strong>
                    Blink once when prompted
                  </strong>

                  <span>
                    Keep looking at the camera and blink naturally after the prompt.
                  </span>
                </div>
              </div>

              <div className="instruction-item">
                <span className="instruction-check">
                  ✓
                </span>

                <div>
                  <strong>
                    Stay within the frame
                  </strong>

                  <span>
                    Keep your face centered and visible.
                  </span>
                </div>
              </div>

            </div>

            {/* Start button */}

            {cameraStatus === "ready" && (
              <>
              <button
                type="button"
                className="face-button"
                onClick={startFaceVerification}
                disabled={hasCompleted}
              >
                <span>
                  Start Blink and Face Verification
                </span>

                <span className="button-arrow">
                  →
                </span>
              </button>
              <p className="face-status">
                A blink is a basic liveness cue and cannot prevent replayed video.
              </p>
              </>
            )}
          </>
        )}

        {/* VERIFYING STATE */}

        {verificationStatus === "verifying" && (
          <div className="verification-status">
            <div className="verification-status-header">

              <div className="verification-spinner">
                <div></div>
              </div>

              <div>
                <h3>
                  {verificationStage === "blink" ? "Blink once now" : verificationStage === "checking" ? "Checking blink and face match" : "Position your face"}
                </h3>

                <p>
                  {verificationStage === "blink" ? "Keep looking at the camera, then blink once." : verificationStage === "checking" ? "Checking the blink and comparing your face with enrollment." : "Keep one face centered and your eyes open until prompted."}
                </p>
              </div>

            </div>

            <div className="verification-progress">
              <div className="verification-progress-header">
                <span>
                  {verificationStage === "blink" ? "Blink check" : "Face and blink check"}
                </span>

                <span>
                  Checking...
                </span>
              </div>

              <div className="verification-progress-track">
                <div className="verification-progress-fill"></div>
              </div>
            </div>
          </div>
        )}

        {error && verificationStatus !== "error" && (
          <p className="face-status error" role="alert">{error}</p>
        )}

        {/* VERIFIED STATE */}

        {verificationStatus === "verified" && (
          <div className="verification-status success">
            <h3>
              ✓ Face verification complete
            </h3>

            <p>
              Submitting attendance for confirmation...
            </p>
          </div>
        )}

        {/* CLASS INFORMATION */}

        <div className="face-footer">
          <span>
            CLASS
          </span>

          <strong>
            {className || "Selected class"}
          </strong>

          <div className="secure-label">
            <span></span>
            Secure identity verification
          </div>
        </div>

      </section>
    </main>
  );
}

export default FaceLiveness;

