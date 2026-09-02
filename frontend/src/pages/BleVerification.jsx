import "../styles/ble-verification.css";

function BleVerification({ className, onVerified }) {
  return (
    <main className="ble-page">
      <section className="ble-card">
        <div className="ble-icon">📡</div>

        <h1>Verify Your Presence</h1>

        <p className="ble-description">
          We need to confirm that you are physically present
          in the classroom before marking attendance.
        </p>

        <div className="ble-status">
          <span className="status-dot"></span>
          <span>Waiting to check proximity</span>
        </div>

        <button
          className="ble-button"
          onClick={onVerified}
        >
          Start Verification
        </button>

        <p className="ble-class">
          Class: <strong>{className}</strong>
        </p>
      </section>
    </main>
  );
}

export default BleVerification;

