import { useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return isLoggedIn ? (
    <Dashboard />
  ) : (
    <Login onLogin={() => setIsLoggedIn(true)} />
  );
}

export default App;


