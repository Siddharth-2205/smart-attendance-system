export function createAttendanceWorkbook(result, XLSX) {
  if (!result?.course || !result?.session || !Array.isArray(result.roster)) {
    throw new Error("The attendance report response is incomplete.");
  }

  const byStudentId = (a, b) => String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true });
  const present = result.roster.filter((student) => student.present).sort(byStudentId);
  const absent = result.roster.filter((student) => !student.present).sort(byStudentId);
  const startedAt = new Date(result.session.createdAt);
  const displayDate = Number.isNaN(startedAt.getTime()) ? result.session.createdAt : startedAt.toLocaleString("en-IN");
  const rows = [
    ["Attendance Report"], ["Class", result.course.name], ["Class ID", result.course.code],
    ["Session ID", result.session.sessionId], ["Session started", displayDate],
    ["Total students", result.roster.length], ["Present", present.length], ["Absent", absent.length], [],
    ["PRESENT STUDENTS"], ["Student ID", "Student Name", "Status", "Marked At"],
    ...present.map((student) => [student.studentId, student.name || "", "Present", student.markedAt ? new Date(student.markedAt).toLocaleString("en-IN") : ""]),
    [], ["ABSENTEES"], ["Student ID", "Student Name", "Status", "Marked At"],
    ...absent.map((student) => [student.studentId, student.name || "", "Absent", ""]),
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 18 }, { wch: 32 }, { wch: 14 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
  const safePart = (value) => String(value).replace(/[^a-z0-9_-]/gi, "_");
  return { workbook, fileName: `attendance_${safePart(result.course.code)}_${safePart(result.session.sessionId)}.xlsx` };
}
