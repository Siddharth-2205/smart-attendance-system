import { useEffect, useState } from "react";
import { api, login, logout } from "../api";
import "../styles/professor-login.css";

function ProfessorLogin({ onLogin, initialError = "" }) {
  const [professorId, setProfessorId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState("");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(true);

  useEffect(() => {
    let mounted = true;
    api("/api/auth/status").then((status) => {
      if (mounted) {
        setRegistrationEnabled(status.professorRegistrationEnabled);
        setPasswordLoginEnabled(status.passwordLoginEnabled);
      }
    }).catch(() => { if (mounted) setRegistrationEnabled(false); });
    return () => { mounted = false; };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    if ((!registering && !professorId.trim()) || !password || (registering && !name.trim())) {
      setError(registering ? "Please enter your name, college email, and password." : "Please enter your Professor ID and password.");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      let user;
      if (registering) {
        const result = await api("/api/auth/register-professor", { method: "POST", body: { name, email: professorId, password } });
        sessionStorage.setItem("token", result.token);
        sessionStorage.setItem("user", JSON.stringify(result.user));
        user = result.user;
      } else {
        user = await login(professorId.trim(), password);
      }
      if (user.role !== "professor") {
        logout();
        throw new Error("This account is for the student portal.");
      }
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="professor-login-page">
      <section className="professor-login-card">
        <div className="professor-login-icon">
          Ã°Å¸â€˜Â¨Ã¢â‚¬ÂÃ°Å¸ÂÂ«
        </div>

        <h1>{registering ? "Professor Registration" : "Professor Login"}</h1>

        <p className="professor-login-subtitle">
          {registering ? "Use your IIIT Dharwad faculty email to register for dashboard access." : "Manage classes and monitor student attendance."}
        </p>

        {passwordLoginEnabled && <form onSubmit={handleSubmit}>
          {registering && <div className="professor-form-group">
            <label htmlFor="professorName">Full name</label>
            <input id="professorName" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" autoComplete="name" required maxLength={80} />
          </div>}
          <div className="professor-form-group">
            <label htmlFor="professorId">
              {registering ? "College email" : "Professor ID or college email"}
            </label>

            <input
              id="professorId"
              type={registering ? "email" : "text"}
              placeholder={registering ? "name@iiitdwd.ac.in" : "Enter your Professor ID or email"}
              value={professorId}
              onChange={(event) =>
                setProfessorId(event.target.value)
              }
              autoComplete={registering ? "email" : "username"}
              required
            />
          </div>

          <div className="professor-form-group">
            <label htmlFor="professorPassword">
              Password
            </label>

            <input
              id="professorPassword"
              type="password"
              placeholder={registering ? "At least 8 characters" : "Enter your password"}
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              autoComplete={registering ? "new-password" : "current-password"}
              minLength={registering ? 8 : undefined}
              required
            />
          </div>

          {error && (
            <p className="professor-login-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="professor-login-button"
          >
            {submitting ? (registering ? "Registering..." : "Signing in...") : (registering ? "Register and Open Dashboard" : "Login to Dashboard")}
          </button>
        </form>}

        {registrationEnabled && <button type="button" className="professor-login-button" style={{ marginTop: 12, background: "transparent", color: "#a5a8ff", border: "1px solid #4545a5" }} onClick={() => { setRegistering((value) => !value); setError(""); }}>
          {registering ? "Already registered? Sign in" : "Professor? Register with college email"}
        </button>}

        <p className="professor-login-footer">
          Smart Attendance System
          <br />
          IIIT Dharwad
        </p>
      </section>
    </main>
  );
}

export default ProfessorLogin;
