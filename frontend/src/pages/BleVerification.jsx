import { useState } from "react";
import "../styles/ble-verification.css";

function BleVerification({ className, onVerified }) {
  const [status, setStatus] = useState("ready");

  const startVerification = () => {
    setStatus("scanning");

    setTimeout(() => {
      setStatus("checking");
    }, 2000);

    setTimeout(() => {
      setStatus("verified");
    }, 4000);
  };

  const getStatusContent = () => {
    switch (status) {
      case "scanning":
        return {
          message: "Scanning for classroom device...",
          className: "scanning",
        };

      case "checking":
        return {
          message: "Checking proximity...",
          className: "checking",
        };

      case "verified":
        return {
          message: "Proximity verified",
          className: "verified",
        };

      default:
        return {
          message: "Waiting to check proximity",
          className: "ready",
        };
    }
  };

  const statusContent = getStatusContent();

  return (
    <main className="ble-page">
      <section className="ble-card">
        <div className="ble-icon">📡</div>

        <h1>Verify Your Presence</h1>

        <p className="ble-description">
          We need to confirm that you are physically present
          in the classroom before marking attendance.
        </p>

        <div className={`ble-status ${statusContent.className}`}>
          <span className="status-dot"></span>
          <span>{statusContent.message}</span>
        </div>

        {status === "ready" && (
          <button
            className="ble-button"
            onClick={startVerification}
          >
            Start Verification
          </button>
        )}

        {(status === "scanning" || status === "checking") && (
          <div className="ble-progress">
            <div className="progress-bar"></div>
            <p>Please stay near the classroom.</p>
          </div>
        )}

        {status === "verified" && (
          <button
            className="ble-button"
            onClick={onVerified}
          >
            Continue to Face Verification
          </button>
        )}

        <p className="ble-class">
          Class: <strong>{className}</strong>
        </p>
      </section>
    </main>
  );
}

export default BleVerification;


