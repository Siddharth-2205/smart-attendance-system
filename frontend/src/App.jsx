import { useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

function App() {
  const [studentId, setStudentId] = useState("");

  const handleLogin = (id) => {
    setStudentId(id);
  };

  return studentId ? (
    <Dashboard studentId={studentId} />
  ) : (
    <Login onLogin={handleLogin} />
  );
}

export default App;

