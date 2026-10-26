import { useEffect, useState } from "react";
import { api } from "../api";
import { QRCodeSVG } from "qrcode.react";
import "../styles/professor-dashboard.css";

// ============================================
// DASHBOARD NAVIGATION
// ============================================

const navigation = [
  { name: "Overview", icon: "⌂" },
  { name: "My Classes", icon: "▤" },
  { name: "Live Attendance", icon: "◉" },
  { name: "Attendance Records", icon: "▦" },
  { name: "Reports", icon: "▥" },
  { name: "Settings", icon: "⚙" },
];

// ============================================
// QR CONFIGURATION
// ============================================

const QR_VALIDITY_SECONDS = 30;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ============================================
// MAIN PROFESSOR DASHBOARD
// ============================================

function ProfessorDashboard({ professorId, onLogout }) {
  // Navigation
  const [activeTab, setActiveTab] = useState("Overview");

  // Class selection
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [pageError, setPageError] = useState("");
  const [scheduleForm, setScheduleForm] = useState(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Attendance session
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState("");

  // Dynamic QR state
  const [sessionToken, setSessionToken] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(QR_VALIDITY_SECONDS);
  const [qrValiditySeconds, setQrValiditySeconds] = useState(QR_VALIDITY_SECONDS);

  // Session duration
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Demo attendance records
  const [demoAttendance, setDemoAttendance] = useState([]);

  // ============================================
  // CURRENT DATE
  // ============================================

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ============================================
  useEffect(() => {
    let active = true;
    api("/api/teacher/courses")
      .then(({ courses: result }) => {
        if (!active) return;
        const mapped = result.map((course) => ({
          ...course,
          time: `${course.startTime} - ${course.endTime}`,
          room: course.beaconId,
        }));
        setClasses(mapped);
        const selected = mapped.find((course) => course.activeSessionCode) || mapped[0] || null;
        setSelectedClass(selected);
        if (selected?.activeSessionCode) {
          setSessionId(selected.activeSessionCode);
          setSessionActive(true);
        }
      })
      .catch((err) => { if (active) setPageError(err.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sessionActive || !sessionId) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const [qr, attendance] = await Promise.all([
          api(`/api/sessions/${encodeURIComponent(sessionId)}/qr`),
          api(`/api/sessions/${encodeURIComponent(sessionId)}/attendance`),
        ]);
        if (!active) return;
        setSessionToken(qr.token);
        setQrValiditySeconds(qr.ttlSeconds ?? QR_VALIDITY_SECONDS);
        setSecondsLeft(Math.max(0, Math.ceil((Date.parse(qr.expiresAt) - Date.now()) / 1000)));
        setDemoAttendance(attendance.roster.filter((student) => student.present).map((student) => ({
          id: student.studentId,
          name: student.name,
          status: "Present",
          time: student.markedAt ? new Date(student.markedAt).toLocaleTimeString("en-IN") : "?",
        })));
        setPageError("");
      } catch (err) {
        if (active) setPageError(err.message);
      }
    };
    refresh();
    const poll = setInterval(refresh, 1000);
    const elapsed = setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => { active = false; clearInterval(poll); clearInterval(elapsed); };
  }, [sessionActive, sessionId]);

  const startSession = async () => {
    if (sessionActive || !selectedClass) return;
    try {
      const session = await api("/api/sessions", {
        method: "POST",
        body: { courseId: currentClass.id },
      });
      setPageError("");
      setSessionId(session.code);
      setDemoAttendance([]);
      setElapsedSeconds(0);
      setSessionActive(true);
      setActiveTab("Live Attendance");
      setClasses((previous) => previous.map((course) => course.id === currentClass.id
        ? { ...course, activeSessionCode: session.code }
        : course));
    } catch (err) {
      setPageError(err.message);
    }
  };

  const stopSession = async () => {
    try {
      await api(`/api/sessions/${encodeURIComponent(sessionId)}/close`, { method: "POST" });
      setSessionActive(false);
      setSessionToken("");
      setSessionId("");
      setSecondsLeft(QR_VALIDITY_SECONDS);
      setClasses((previous) => previous.map((course) => course.code === selectedClass?.code
        ? { ...course, activeSessionCode: null }
        : course));
      setPageError("");
    } catch (err) {
      setPageError(err.message);
    }
  };

  const editSchedule = (course = null) => {
    setPageError("");
    setScheduleForm(course ? {
      id: course.id, name: course.name, code: course.code, days: course.days || [],
      startTime: course.startTime, endTime: course.endTime, beaconId: course.beaconId,
      students: course.students || 0, studentIdsText: (course.studentIds || []).join(", "),
    } : { name: "", code: "", days: ["Monday"], startTime: "09:00", endTime: "10:00", beaconId: "", students: 0, studentIdsText: "" });
  };

  const saveSchedule = async (event) => {
    event.preventDefault();
    if (!scheduleForm) return;
    setScheduleSaving(true);
    try {
      const saved = await api(scheduleForm.id ? `/api/teacher/courses/${encodeURIComponent(scheduleForm.id)}` : "/api/teacher/courses", {
        method: scheduleForm.id ? "PUT" : "POST",
        body: { ...scheduleForm, studentIds: scheduleForm.studentIdsText.split(",").map((id) => id.trim()).filter(Boolean), beaconId: scheduleForm.beaconId || `Room ${scheduleForm.code}` },
      });
      const course = { ...saved.course, time: `${saved.course.startTime} - ${saved.course.endTime}`, room: saved.course.beaconId };
      setClasses((previous) => scheduleForm.id ? previous.map((item) => item.id === course.id ? course : item) : [...previous, course]);
      if (selectedClass?.id === course.id) setSelectedClass(course);
      setScheduleForm(null);
      setPageError("");
    } catch (err) { setPageError(err.message); }
    finally { setScheduleSaving(false); }
  };

  const removeSchedule = async (course) => {
    if (!window.confirm(`Remove ${course.code} from your schedule?`)) return;
    try {
      await api(`/api/teacher/courses/${encodeURIComponent(course.id)}`, { method: "DELETE" });
      setClasses((previous) => previous.filter((item) => item.id !== course.id));
      if (selectedClass?.id === course.id) setSelectedClass(null);
      setPageError("");
    } catch (err) { setPageError(err.message); }
  };

  // ============================================
  //   // OPEN A CLASS
  // ============================================

  const openClass = (classItem) => {
    if (sessionActive && currentClass.code !== classItem.code) {
      window.alert(
        "Please end the current attendance session before switching classes."
      );

      return;
    }

    setSelectedClass(classItem);

    setActiveTab("Live Attendance");
  };

  // ============================================
  // FORMAT SESSION DURATION
  // ============================================

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);

    const minutes = Math.floor((seconds % 3600) / 60);

    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(
        minutes
      ).padStart(2, "0")}:${String(
        remainingSeconds
      ).padStart(2, "0")}`;
    }

    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  };

  // ============================================
  // ATTENDANCE STATISTICS
  // ============================================

  const currentClass = selectedClass || classes[0] || {
    name: "No courses available", code: "", room: "", students: 0,
  };

  const presentCount = demoAttendance.filter(
    (student) => student.status === "Present"
  ).length;

  const attendancePercentage =
    currentClass.students > 0
      ? Math.round(
          (presentCount / currentClass.students) * 100
        )
      : 0;

  // ============================================
  // MAIN UI
  // ============================================

  return (
    <div className="professor-layout">
      {pageError && <p className="professor-login-error" role="alert">{pageError}</p>}

      {/* ========================================
          SIDEBAR
      ======================================== */}

      <aside className="professor-sidebar">

        <div className="professor-brand">
          <div className="brand-icon">S</div>

          <div>
            <h2>Smart Attendance</h2>
            <p>Professor Portal</p>
          </div>
        </div>

        <div className="sidebar-label">
          WORKSPACE
        </div>

        <nav className="professor-navigation">
          {navigation.map((item) => (
            <button
              key={item.name}
              type="button"
              className={
                activeTab === item.name
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => setActiveTab(item.name)}
            >
              <span className="nav-icon">
                {item.icon}
              </span>

              {item.name}
            </button>
          ))}
        </nav>

        {/* Professor profile and logout */}

        <div className="sidebar-bottom">

          <div className="sidebar-profile">

            <div className="profile-avatar">
              P
            </div>

            <div>
              <strong>
                {professorId || "Professor"}
              </strong>

              <span>Professor</span>
            </div>

          </div>

          <button
            type="button"
            className="logout-button"
            onClick={onLogout}
          >
            ↪ Logout
          </button>

        </div>

      </aside>

      {/* ========================================
          MAIN CONTENT
      ======================================== */}

      <main className="professor-main">

        {/* HEADER */}

        <header className="professor-topbar">

          <div>
            <p className="breadcrumb">
              Workspace / {activeTab}
            </p>

            <h1>{activeTab}</h1>
          </div>

          <div className="topbar-right">

            <span className="system-status">
              <span className="status-dot" />
              System Online
            </span>

            <div className="topbar-avatar">
              P
            </div>

          </div>

        </header>

        {/* ========================================
            OVERVIEW
        ======================================== */}

        {activeTab === "Overview" && (
          <>

            {/* Welcome banner */}

            <section className="welcome-banner">

              <div>

                <p className="welcome-eyebrow">
                  PROFESSOR WORKSPACE
                </p>

                <h2>
                  Good morning, Professor 👋
                </h2>

                <p>
                  Manage your classes and monitor attendance
                  from one place.
                </p>

                <span className="welcome-date">
                  {today}
                </span>

              </div>

              <div className="welcome-illustration">
                📚
              </div>

            </section>

            {/* Statistics */}

            <section className="stats-grid">

              <article className="stat-card">

                <div className="stat-heading">
                  Classes Today <span>▤</span>
                </div>

                <strong>{classes.length}</strong>

                <p>Your scheduled classes</p>

              </article>

              <article className="stat-card">

                <div className="stat-heading">
                  Students Present <span>♙</span>
                </div>

                <strong>{presentCount}</strong>

                <p>Recorded in this demo</p>

              </article>

              <article className="stat-card">

                <div className="stat-heading">
                  Attendance Rate <span>◔</span>
                </div>

                <strong>
                  {demoAttendance.length > 0
                    ? `${attendancePercentage}%`
                    : "—"}
                </strong>

                <p>Current session</p>

              </article>

              <article className="stat-card">

                <div className="stat-heading">
                  Active Sessions <span>◉</span>
                </div>

                <strong>
                  {sessionActive ? 1 : 0}
                </strong>

                <p>
                  {sessionActive
                    ? "Attendance in progress"
                    : "No active sessions"}
                </p>

              </article>

            </section>

            {/* Today's schedule */}

            <section className="schedule-panel">

              <div className="section-heading">

                <div>
                  <h2>Today's Schedule</h2>

                  <p>
                    Your scheduled classes at a glance.
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setActiveTab("My Classes")}
                >
                  View all classes →
                </button>

              </div>

              <div className="schedule-list">

                {classes.map((item) => (

                  <article
                    className="schedule-card"
                    key={item.code}
                  >

                    <div className="class-icon">
                      ▤
                    </div>

                    <div className="class-details">

                      <h3>{item.name}</h3>

                      <p>
                        {item.code} · {item.room}
                      </p>

                      <span>{item.time}</span>

                    </div>

                    <span className="class-status">
                      {sessionActive &&
                      currentClass.code === item.code
                        ? "Live"
                        : "Upcoming"}
                    </span>

                    <button
                      type="button"
                      className="start-button"
                      onClick={() => openClass(item)}
                    >
                      View Class
                    </button>

                  </article>

                ))}

              </div>

            </section>

            {/* Quick actions */}

            <section className="quick-actions-panel">

              <div className="section-heading">
                <div>
                  <h2>Quick Actions</h2>

                  <p>
                    Frequently used professor tools.
                  </p>
                </div>
              </div>

              <div className="quick-actions-grid">

                <button
                  type="button"
                  className="quick-action"
                  onClick={() => {
                    if (sessionActive) {
                      setActiveTab("Live Attendance");
                    } else {
                      setSelectedClass(classes[0]);
                      setActiveTab("Live Attendance");
                    }
                  }}
                >

                  <span>＋</span>

                  <div>
                    <strong>Start Attendance</strong>

                    <p>
                      Choose a class to begin.
                    </p>
                  </div>

                  <b>→</b>

                </button>

                <button
                  type="button"
                  className="quick-action"
                  onClick={() =>
                    setActiveTab("Attendance Records")
                  }
                >

                  <span>▦</span>

                  <div>
                    <strong>Attendance Records</strong>

                    <p>
                      Review recorded attendance.
                    </p>
                  </div>

                  <b>→</b>

                </button>

                <button
                  type="button"
                  className="quick-action"
                  onClick={() => setActiveTab("Reports")}
                >

                  <span>▥</span>

                  <div>
                    <strong>View Reports</strong>

                    <p>
                      Explore attendance reports.
                    </p>
                  </div>

                  <b>→</b>

                </button>

              </div>

            </section>

          </>
        )}

        {/* ========================================
            MY CLASSES
        ======================================== */}

        {activeTab === "My Classes" && (

          <section className="classes-page">

            <div className="section-heading">

              <div>
                <h2>Your Classes</h2>

                <p>
                  View your assigned courses and manage
                  attendance.
                </p>
              </div>

            </div>

            <button type="button" className="start-button" onClick={() => editSchedule()}>+ Add class</button>
            {scheduleForm && <form className="schedule-editor" onSubmit={saveSchedule}>
              <h3>{scheduleForm.id ? "Edit scheduled class" : "Add scheduled class"}</h3>
              <div className="schedule-editor-grid">
                <label>Course name<input required maxLength={100} value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} /></label>
                <label>Course code<input required maxLength={20} value={scheduleForm.code} onChange={(e) => setScheduleForm({ ...scheduleForm, code: e.target.value.toUpperCase() })} /></label>
                <label>Start time<input type="time" required value={scheduleForm.startTime} onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })} /></label>
                <label>End time<input type="time" required value={scheduleForm.endTime} onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })} /></label>
                <label>Room<input required value={scheduleForm.beaconId} placeholder="e.g. Room 204" onChange={(e) => setScheduleForm({ ...scheduleForm, beaconId: e.target.value })} /></label>
                <label className="enrollment-list-field">Enrolled student roll numbers<input required value={scheduleForm.studentIdsText} placeholder="23BCS001, 24BDA002, 25BEC003" onChange={(e) => setScheduleForm({ ...scheduleForm, studentIdsText: e.target.value })} /><small>Use YYBCSNNN (CSE), YYBDANNN (DSAI), or YYBECNNN (ECE), separated by commas. Students must also be registered.</small></label>
              </div>
              <fieldset className="schedule-days"><legend>Class days</legend>{WEEKDAYS.map((day) => <label key={day}><input type="checkbox" checked={scheduleForm.days.includes(day)} onChange={(e) => setScheduleForm({ ...scheduleForm, days: e.target.checked ? [...scheduleForm.days, day] : scheduleForm.days.filter((item) => item !== day) })} />{day.slice(0, 3)}</label>)}</fieldset>
              <div className="schedule-editor-actions"><button className="start-button" type="submit" disabled={scheduleSaving}>{scheduleSaving ? "Saving..." : "Save class"}</button><button type="button" className="secondary-button" onClick={() => setScheduleForm(null)}>Cancel</button></div>
            </form>}

            <div className="classes-grid">

              {classes.map((item) => (

                <article
                  className="course-card"
                  key={item.code}
                >

                  <div className="course-card-top">

                    <div className="class-icon">
                      ▤
                    </div>

                    <span className="class-status">
                      {sessionActive &&
                      currentClass.code === item.code
                        ? "Live"
                        : "Upcoming"}
                    </span>

                  </div>

                  <h2>{item.name}</h2>

                  <p className="course-code">
                    {item.code}
                  </p>
                  <p className="course-code">{(item.days || []).join(", ")} · {item.time}</p>

                  <div className="course-meta">

                    <p>◷ {item.time}</p>

                    <p>⌂ {item.room}</p>

                    <p>
                      ♙ {item.students} enrolled students
                    </p>

                  </div>

                  <button
                    type="button"
                    className="start-button full-width"
                    onClick={() => openClass(item)}
                  >
                    View Class →
                  </button>
                  <div className="schedule-card-actions"><button type="button" className="secondary-button" onClick={() => editSchedule(item)}>Edit schedule</button><button type="button" className="secondary-button" onClick={() => removeSchedule(item)}>Remove</button></div>

                </article>

              ))}

            </div>

          </section>

        )}

        {/* ========================================
            LIVE ATTENDANCE
        ======================================== */}

        {activeTab === "Live Attendance" && (

          <section className="live-attendance-page">

            {/* Session heading */}

            <div className="live-page-intro">

              <div>

                <h2>Live Attendance Session</h2>

                <p>
                  Start a session and manage student
                  attendance securely.
                </p>

              </div>

              <span
                className={
                  sessionActive
                    ? "session-badge session-live"
                    : "session-badge session-idle"
                }
              >

                <span className="status-dot" />

                {sessionActive
                  ? "Session Live"
                  : "Session Inactive"}

              </span>

            </div>

            {/* Class selector and controls */}

            <div className="session-controls">

              <div className="session-class-selector">

                <label htmlFor="attendance-class">
                  Select Class
                </label>

                <select
                  id="attendance-class"
                  value={currentClass.code}
                  disabled={sessionActive}
                  onChange={(event) => {

                    const nextClass = classes.find(
                      (item) =>
                        item.code === event.target.value
                    );

                    if (nextClass) {
                      setSelectedClass(nextClass);
                      setDemoAttendance([]);
                    }

                  }}
                >

                  {classes.map((item) => (

                    <option
                      key={item.code}
                      value={item.code}
                    >
                      {item.name} ({item.code})
                    </option>

                  ))}

                </select>

              </div>

              <div className="session-control-actions">

                {!sessionActive ? (

                  <button
                    type="button"
                    className="start-button"
                    onClick={startSession}
                  >
                    ▶ Start Attendance
                  </button>

                ) : (

                  <button
                    type="button"
                    className="stop-session-button"
                    onClick={stopSession}
                  >
                    ■ End Session
                  </button>

                )}

              </div>

            </div>

            {/* QR and session information */}

            <div className="live-session-grid">

              {/* DYNAMIC QR CARD */}

              <article className="live-session-card qr-session-card">

                <div className="live-card-heading">

                  <div>

                    <h3>Dynamic QR Code</h3>

                    <p>
                      Rotates automatically every {qrValiditySeconds} seconds.
                    </p>

                  </div>

                  <span className="qr-icon">
                    ▦
                  </span>

                </div>

                {sessionActive ? (

                  <>

                    <div className="qr-code-container">

                      <QRCodeSVG
                        value={JSON.stringify({
                          sessionId,
                          token: sessionToken,
                        })}
                        size={210}
                        level="H"
                        includeMargin
                      />

                    </div>

                    {/* Countdown */}

                    <div className="qr-countdown">

                      <div className="countdown-label">

                        <span>Next QR refresh</span>

                        <strong>
                          {secondsLeft}s
                        </strong>

                      </div>

                      <div className="countdown-track">

                        <div
                          className="countdown-progress"
                          style={{
                            width: `${
                              (secondsLeft /
                                qrValiditySeconds) *
                              100
                            }%`,
                          }}
                        />

                      </div>

                    </div>

                    <p className="qr-security-note">
                      Current QR token: {sessionToken.slice(0, 12)}…
                    </p>

                    <p className="qr-security-note">
                      Session ID: {sessionId}
                    </p>

                  </>

                ) : (

                  <div className="qr-inactive">

                    <div className="qr-placeholder">
                      ▦
                    </div>

                    <h3>QR code not generated</h3>

                    <p>
                      Start an attendance session to generate
                      the rotating QR code.
                    </p>

                  </div>

                )}

              </article>

              {/* SESSION INFORMATION */}

              <article className="live-session-card">

                <div className="live-card-heading">

                  <div>

                    <h3>Session Information</h3>

                    <p>
                      Current attendance session details.
                    </p>

                  </div>

                </div>

                <div className="session-info-list">

                  <div>
                    <span>Course</span>

                    <strong>
                      {currentClass.name}
                    </strong>
                  </div>

                  <div>
                    <span>Course Code</span>

                    <strong>
                      {currentClass.code}
                    </strong>
                  </div>

                  <div>
                    <span>Classroom</span>

                    <strong>
                      {currentClass.room}
                    </strong>
                  </div>

                  <div>
                    <span>Enrolled Students</span>

                    <strong>
                      {currentClass.students}
                    </strong>
                  </div>

                  <div>
                    <span>Session Duration</span>

                    <strong>
                      {formatDuration(elapsedSeconds)}
                    </strong>
                  </div>

                  <div>
                    <span>Verification</span>

                    <strong>
                      Dynamic QR + Face Verification
                    </strong>
                  </div>

                </div>

                {/* Verification workflow */}

                <div className="verification-flow">

                  <h4>Verification Process</h4>

                  <div className="verification-step">

                    <span>1</span>

                    <div>

                      <strong>Dynamic QR Verification</strong>

                      <p>
                        Validate the active session token with the server.
                      </p>

                    </div>

                  </div>

                  <div className="verification-step">

                    <span>2</span>

                    <div>

                      <strong>Face Match and Action Checks</strong>

                      <p>
                        Match the enrolled face and check prompted movements.
                      </p>

                    </div>

                  </div>

                  <div className="verification-step">

                    <span>3</span>

                    <div>

                      <strong>Attendance Recording</strong>

                      <p>
                        Record attendance after successful
                        verification.
                      </p>

                    </div>

                  </div>

                </div>

              </article>

            </div>

            {/* LIVE ATTENDANCE ROSTER */}

            <article className="live-session-card roster-card">

              <div className="section-heading">

                <div>

                  <h2>Live Attendance Roster</h2>

                  <p>
                    Monitor attendance recorded during this session.
                  </p>

                </div>

                <span className="roster-count">
                  {presentCount} / {currentClass.students} Present
                </span>

              </div>

              {demoAttendance.length === 0 ? (

                <div className="empty-roster">

                  <div>♙</div>

                  <h3>No attendance recorded yet</h3>

                  <p>
                    Students who complete attendance will appear here.
                  </p>

                </div>

              ) : (

                <div className="roster-table-wrapper">

                  <table className="roster-table">

                    <thead>

                      <tr>
                        <th>Student</th>
                        <th>Student ID</th>
                        <th>Time</th>
                        <th>Status</th>
                      </tr>

                    </thead>

                    <tbody>

                      {demoAttendance.map((student) => (

                        <tr key={student.id}>

                          <td>{student.name}</td>

                          <td>{student.id}</td>

                          <td>{student.time}</td>

                          <td>

                            <span className="present-status">
                              Present
                            </span>

                          </td>

                        </tr>

                      ))}

                    </tbody>

                  </table>

                </div>

              )}

            </article>

          </section>

        )}

        {/* ========================================
            ATTENDANCE RECORDS
        ======================================== */}

        {activeTab === "Attendance Records" && (

          <section className="placeholder-panel">

            <div className="placeholder-icon">
              ▦
            </div>

            <h2>Attendance Records</h2>

            <p>
              Historical attendance records will be displayed
              here after backend integration.
            </p>

            <button
              type="button"
              className="secondary-button"
              onClick={() => setActiveTab("Live Attendance")}
            >
              Open Live Attendance →
            </button>

          </section>

        )}

        {/* ========================================
            REPORTS
        ======================================== */}

        {activeTab === "Reports" && (

          <section className="placeholder-panel">

            <div className="placeholder-icon">
              ▥
            </div>

            <h2>Attendance Reports</h2>

            <p>
              Attendance summaries, class-wise statistics,
              and downloadable reports will be implemented
              after backend integration.
            </p>

            <button
              type="button"
              className="secondary-button"
              onClick={() => setActiveTab("Attendance Records")}
            >
              View Attendance Records →
            </button>

          </section>

        )}

        {/* ========================================
            SETTINGS
        ======================================== */}

        {activeTab === "Settings" && (

          <section className="placeholder-panel">

            <div className="placeholder-icon">
              ⚙
            </div>

            <h2>Settings</h2>

            <p>
              Professor profile, account preferences, and
              session settings will be available here.
            </p>

            <button
              type="button"
              className="secondary-button"
              onClick={onLogout}
            >
              Logout
            </button>

          </section>

        )}

        {/* FOOTER */}

        <footer className="professor-footer">
          Smart Attendance System · IIIT Dharwad
        </footer>

      </main>

    </div>
  );
}

export default ProfessorDashboard;

