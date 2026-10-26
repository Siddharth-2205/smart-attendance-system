import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "../api";
import "../styles/student-qr-verification.css";

const SCANNER_ID = "student-qr-reader";

function StudentQRVerification({ className, attemptId, onVerified }) {
  const callbackRef = useRef(onVerified);
  const scannerRef = useRef(null);
  const completedRef = useRef(false);
  const validatingRef = useRef(false);
  const pausedRef = useRef(false);
  const [status, setStatus] = useState("starting");
  const [message, setMessage] = useState("Starting the camera...");
  const [error, setError] = useState("");
  const [scanCycle, setScanCycle] = useState(0);

  useEffect(() => { callbackRef.current = onVerified; }, [onVerified]);

  useEffect(() => {
    let disposed = false;
    let started = false;
    const scanner = new Html5Qrcode(SCANNER_ID);
    scannerRef.current = scanner;

    const stopAndClear = async () => {
      if (started) {
        try { await scanner.stop(); } catch { /* already stopped */ }
        started = false;
      }
      try { scanner.clear(); } catch { /* already cleared */ }
      if (scannerRef.current === scanner) scannerRef.current = null;
    };

    const handleDecoded = async (decodedText) => {
      if (disposed || completedRef.current || validatingRef.current || pausedRef.current) return;
      validatingRef.current = true;
      setStatus("validating");
      setError("");
      setMessage("Checking the QR code with the attendance server...");

      try {
        let payload;
        try { payload = JSON.parse(decodedText); }
        catch { throw new Error("This QR code is not a valid attendance code. Scan the current code shown by your professor."); }
        if (typeof payload?.sessionId !== "string" || !payload.sessionId || typeof payload?.token !== "string" || !/^[a-f0-9]{48}$/i.test(payload.token)) {
          throw new Error("This QR code is malformed. Scan the current attendance code shown by your professor.");
        }
        const result = await api(`/api/attendance/attempts/${encodeURIComponent(attemptId)}/qr`, {
          method: "POST",
          body: { sessionId: payload.sessionId, token: payload.token },
        });
        if (disposed) return;
        completedRef.current = true;
        setStatus("verified");
        setMessage("QR verified. Continue to face verification.");
        await stopAndClear();
        await callbackRef.current?.({ ...result, sessionId: payload.sessionId });
      } catch (err) {
        if (disposed) return;
        pausedRef.current = true;
        setStatus("error");
      setError(err.message || "The QR code could not be verified.");
        setMessage("The camera is still active. Scan a current code or try again.");
      } finally {
        validatingRef.current = false;
      }
    };

    async function start() {
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 12, aspectRatio: 1, qrbox: (width, height) => {
            const size = Math.min(320, Math.floor(Math.min(width, height) * 0.8));
            return { width: size, height: size };
          } },
          handleDecoded,
          () => {}
        );
        started = true;
        if (disposed) await stopAndClear();
        else {
          setStatus("scanning");
          setMessage("Point your camera at the professor's current QR code.");
        }
      } catch (err) {
        if (disposed) return;
        setStatus("error");
        setError(err.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access and retry." : "Unable to start the QR camera. Close other camera apps and retry.");
        setMessage("QR scanning needs camera permission and a secure browser context.");
        await stopAndClear();
      }
    }

    start();
    return () => {
      disposed = true;
      void stopAndClear();
    };
  }, [attemptId, scanCycle]);

  const retry = () => {
    completedRef.current = false;
    pausedRef.current = false;
    setError("");
    if (scannerRef.current) {
      setStatus("scanning");
      setMessage("Point your camera at the professor's current QR code.");
      return;
    }
    setStatus("starting");
    setMessage("Restarting the camera...");
    setScanCycle((cycle) => cycle + 1);
  };

  return (
    <main className="qr-verification-page">
      <section className="qr-verification-card">
        <header className="qr-header">
          <div className="qr-icon">▦</div>
          <div>
            <span className="qr-step">STEP 2 OF 4</span>
            <h1>Scan Attendance QR</h1>
            <p>Scan the professor's rotating code. The server checks that it belongs to this active class session.</p>
          </div>
        </header>

        <div className="qr-class-info"><span>CLASS</span><strong>{className || "Selected class"}</strong></div>
        <div className="qr-scanner-panel">
          {(status === "scanning" || status === "starting" || status === "validating") && <div className="qr-scanner-heading"><span className="qr-live-dot" />{status === "validating" ? "Validating QR" : status === "starting" ? "Starting camera" : "Camera scanner ready"}</div>}
          <div id={SCANNER_ID} className="student-qr-reader" />
          <p className="qr-scanner-status" role="status">{message}</p>
          {status === "verified" && <div className="qr-result qr-result-success"><div className="qr-result-icon">✓</div><h2>QR Verified</h2><p>{message}</p></div>}
          {status === "error" && <div className="qr-result qr-result-error"><div className="qr-result-icon">!</div><h2>Could not verify QR</h2><p>{error}</p><button type="button" className="qr-retry-button" onClick={retry}>Scan again</button></div>}
        </div>
        <div className="qr-instructions"><h3>Before you scan</h3><p>Ask your professor to start the attendance session and display its current QR code.</p><p>Keep the code clear, well-lit, and inside the camera frame.</p></div>
        <div className="qr-security-note"><span>●</span> QR token is verified by the attendance server</div>
      </section>
    </main>
  );
}

export default StudentQRVerification;
