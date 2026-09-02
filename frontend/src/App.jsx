import { useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import BleVerification from "./pages/BleVerification";

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
        onVerified={() => console.log("BLE verification complete")}
      />
    );
  }
}

export default App;


