import { lazy, Suspense, useEffect, useState } from "react";
import { api, logout } from "./api";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const FaceLiveness = lazy(() => import("./pages/FaceLiveness"));
const StudentQRVerification = lazy(() => import("./pages/StudentQRVerification"));
const AttendanceSuccess = lazy(() => import("./pages/AttendanceSuccess"));
const ProfessorLogin = lazy(() => import("./pages/ProfessorLogin"));
const ProfessorDashboard = lazy(() => import("./pages/ProfessorDashboard"));

const PageFallback = () => <main className="login-page" role="status">Loading…</main>;

function App() {
  const savedUser = (() => { try { return JSON.parse(sessionStorage.getItem("user") || "null"); } catch { return null; } })();
  const [studentId, setStudentId] = useState(savedUser?.role === "student" ? savedUser.loginId : "");
  const [selectedClass, setSelectedClass] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const initialPage = savedUser?.role === "student" ? "dashboard" : savedUser?.role === "professor" ? "professor-dashboard" : "login";
  const [currentPage, setCurrentPage] = useState(initialPage);

  const [professorId, setProfessorId] = useState(savedUser?.role === "professor" ? savedUser.loginId : "");

  const [verifiedQR, setVerifiedQR] = useState(null);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const handleExpiredSession = (event) => {
      setCurrentPage(event.detail?.role === "professor" ? "professor-login" : "login");
      setStudentId("");
      setProfessorId("");
      setSelectedClass(null);
      setAttempt(null);
      setVerifiedQR(null);
      setAuthError("Your sign-in expired. Please sign in again.");
    };
    window.addEventListener("attendance-auth-expired", handleExpiredSession);
    return () => window.removeEventListener("attendance-auth-expired", handleExpiredSession);
  }, []);

  // ==========================================
  // STUDENT FLOW
  // ==========================================

  const handleLogin = (user) => {
    setStudentId(user.loginId);
    setCurrentPage("dashboard");
  };

  const handleAttendance = async (course) => {
    try {
      const nextAttempt = await api("/api/attendance/attempts", {
        method: "POST",
        body: { courseId: course.courseId },
      });
      setSelectedClass(course);
      setAttempt(nextAttempt);
      setVerifiedQR(null);
      setCurrentPage("qr");
    } catch (error) {
      window.alert(error.message);
    }
  };

  const handleQRVerified = (qrData) => {
    setVerifiedQR(qrData);
    setCurrentPage("face");
  };

  const finishAttendance = async () => {
    const result = await api(`/api/attendance/attempts/${attempt.attemptId}/complete`, { method: "POST" });
    setVerifiedQR(result);
    setCurrentPage("success");
  };

  const handleFaceVerified = async () => {
    await finishAttendance();
  };

  // ==========================================
  // PROFESSOR FLOW
  // ==========================================

  const handleProfessorLogin = (professor) => {
    setProfessorId(professor.loginId);
    setCurrentPage("professor-dashboard");
  };

  // ==========================================
  // STUDENT LOGIN
  // ==========================================

  if (currentPage === "login") {
    return (
      <div>
        <Suspense fallback={<PageFallback />}>
          <Login onLogin={handleLogin} initialError={authError} />
        </Suspense>

        <div
          style={{
            textAlign: "center",
            padding: "16px",
            background: "#080c18",
          }}
        >
          <button
            onClick={() => setCurrentPage("professor-login")}
            style={{
              background: "transparent",
              color: "#a5a8ff",
              border: "1px solid #4545a5",
              borderRadius: "8px",
              padding: "10px 20px",
              cursor: "pointer",
            }}
          >
            Professor Login →
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // STUDENT DASHBOARD
  // ==========================================

  if (currentPage === "dashboard") {
    return (
      <Suspense fallback={<PageFallback />}>
      <Dashboard
        studentId={studentId}
        onAttendance={handleAttendance}
      />
      </Suspense>
    );
  }

  // ==========================================
  // FACE VERIFICATION
  // ==========================================

  if (currentPage === "face") {
    return (
      <Suspense fallback={<PageFallback />}>
      <FaceLiveness
        className={selectedClass?.name}
        attemptId={attempt?.attemptId}
        onVerified={handleFaceVerified}
      />
      </Suspense>
    );
  }

  // ==========================================
  // DYNAMIC QR VERIFICATION
  // ==========================================

  if (currentPage === "qr") {
    return (
      <Suspense fallback={<PageFallback />}>
      <StudentQRVerification
        className={selectedClass?.name}
        attemptId={attempt?.attemptId}
        onVerified={handleQRVerified}
      />
      </Suspense>
    );
  }

  // ==========================================
  // ATTENDANCE SUCCESS
  // ==========================================

  if (currentPage === "success") {
    return (
      <Suspense fallback={<PageFallback />}>
      <AttendanceSuccess
        attendance={verifiedQR}
        onReturn={() => { setAttempt(null); setSelectedClass(null); setCurrentPage("dashboard"); }}
      />
      </Suspense>
    );
  }

  // ==========================================
  // PROFESSOR LOGIN
  // ==========================================

  if (currentPage === "professor-login") {
    return (
      <Suspense fallback={<PageFallback />}>
      <ProfessorLogin
        onLogin={handleProfessorLogin}
        initialError={authError}
      />
      </Suspense>
    );
  }

  // ==========================================
  // PROFESSOR DASHBOARD
  // ==========================================

  if (currentPage === "professor-dashboard") {
    return (
      <Suspense fallback={<PageFallback />}>
      <ProfessorDashboard
        professorId={professorId}
        onLogout={() => {
          logout();
          setProfessorId("");
          setStudentId("");
          setCurrentPage("login");
        }}
      />
      </Suspense>
    );
  }

  return null;
}

export default App;

