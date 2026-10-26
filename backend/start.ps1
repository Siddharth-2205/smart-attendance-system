$ErrorActionPreference = "Stop"
$env:HOST = "0.0.0.0"
$env:PORT = "4000"
$env:FACE_SERVICE_URL = "http://127.0.0.1:5001"
$env:QR_TTL_SECONDS = "5"
$env:ALLOW_SELF_SERVICE_PROFESSOR_REGISTRATION = "true"
# Seeded local accounts; the range below is the requested laptop registration
# allowlist. For a real deployment, clear STUDENT_ROSTER_RANGE and use only the
# institution-approved exact STUDENT_ROSTER.
if (-not $env:STUDENT_ROSTER) {
  $env:STUDENT_ROSTER = "23BCS001,23BCS002,23BCS003,23BCS004,23BCS005,25BCS090"
}
if (-not $env:STUDENT_ROSTER_RANGE) {
  $env:STUDENT_ROSTER_RANGE = "001-300"
}
if (-not $env:CORS_ORIGINS) {
  $env:CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,https://localhost:5174,https://127.0.0.1:5174,https://10.0.1.72:5174"
}
Set-Location $PSScriptRoot
npm.cmd start
exit $LASTEXITCODE
