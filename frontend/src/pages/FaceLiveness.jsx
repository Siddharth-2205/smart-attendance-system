import { useEffect, useRef, useState } from "react";
import "../styles/face-liveness.css";

function FaceLiveness({ className, onVerified }) {
  const videoRef = useRef(null);

  const [cameraStatus, setCameraStatus] = useState("requesting");
  const [verificationStatus, setVerificationStatus] = useState("ready");
  const [error, setError] = useState("");

  useEffect(() => {
    let stream;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setCameraStatus("ready");
      } catch (err) {
        console.error("Camera access error:", err);

        setCameraStatus("error");
        setError(
          "Camera access is required for face verification."
        );
      }
    };

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startFaceVerification = () => {
    setVerificationStatus("verifying");

    // Temporary simulation.
    // This will later be replaced by the actual
    // face liveness detection result.

    setTimeout(() => {
      setVerificationStatus("verified");
    }, 3000);

    setTimeout(() => {
      onVerified();
    }, 4500);
  };

  return (
    <main className="face-page">
      <section className="face-card">

        <div className="face-header">
          <div className="face-icon">📷</div>

          <h1>Face Verification</h1>

          <p>
            Look directly at the camera to verify that you
            are physically present.
          </p>
        </div>

        <div
          className={`camera-container ${
            verificationStatus === "verifying"
              ? "verifying"
              : ""
          }`}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera-preview"
          />

          {cameraStatus === "requesting" && (
            <div className="camera-message">
              Requesting camera access...
            </div>
          )}

          {cameraStatus === "error" && (
            <div className="camera-message error">
              {error}
            </div>
          )}

          {verificationStatus === "verifying" && (
            <div className="face-frame"></div>
          )}

          {verificationStatus === "verified" && (
            <div className="verification-overlay">
              <div className="success-icon">✓</div>
              <p>Liveness Verified</p>
            </div>
          )}
        </div>

        {verificationStatus === "ready" && (
          <>
            <div className="face-instructions">
              <p>✓ Make sure your face is clearly visible</p>
              <p>✓ Look directly at the camera</p>
              <p>✓ Stay within the camera frame</p>
            </div>

            {cameraStatus === "ready" && (
              <button
                className="face-button"
                onClick={startFaceVerification}
              >
                Start Face Verification
              </button>
            )}
          </>
        )}

        {verificationStatus === "verifying" && (
          <div className="verification-status">
            <div className="spinner"></div>

            <h3>Verifying your presence...</h3>

            <p>
              Please keep your face visible and stay still.
            </p>
          </div>
        )}

        {verificationStatus === "verified" && (
          <div className="verification-status success">
            <h3>✓ Liveness verification successful</h3>

            <p>
              Attendance is being recorded...
            </p>
          </div>
        )}

        <p className="face-class">
          Class: <strong>{className}</strong>
        </p>

      </section>
    </main>
  );
}

export default FaceLiveness;

