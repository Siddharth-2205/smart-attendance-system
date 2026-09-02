import { useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import BleVerification from "./pages/BleVerification";
import FaceLiveness from "./pages/FaceLiveness";
import AttendanceSuccess from "./pages/AttendanceSuccess";

function App() {
  const [studentId, setStudentId] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [currentPage, setCurrentPage] = useState("login");

  const handleLogin = (id) => {
    setStudentId(id);
    setCurrentPage("dashboard");
  };

  const handleAttendance = (className) => {
    setSelectedClass(className);
    setCurrentPage("ble");
  };

  const handleBleVerified = () => {
    setCurrentPage("face");
  };

  const handleFaceVerified = () => {
    setCurrentPage("success");
  };

  if (currentPage === "login") {
    return <Login onLogin={handleLogin} />;
  }

  if (currentPage === "dashboard") {
    return (
      <Dashboard
        studentId={studentId}
        onAttendance={handleAttendance}
      />
    );
  }

  if (currentPage === "ble") {
    return (
      <BleVerification
        className={selectedClass}
        onVerified={handleBleVerified}
      />
    );
  }

  if (currentPage === "face") {
    return (
      <FaceLiveness
        className={selectedClass}
        onVerified={handleFaceVerified}
      />
    );
  }

  if (currentPage === "success") {
  return (
    <AttendanceSuccess
      className={selectedClass}
    />
  );
}

  return null;
}

export default App;

