$ErrorActionPreference = "Stop"

$python = Join-Path $env:LOCALAPPDATA "Programs\Python311\python.exe"
$pythonArguments = @()
if (-not (Test-Path -LiteralPath $python)) {
  $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($launcher) {
    & $launcher.Source -3.11 --version *> $null
    if ($LASTEXITCODE -eq 0) {
      $python = $launcher.Source
      $pythonArguments = @("-3.11")
    }
  }
}
if (-not (Test-Path -LiteralPath $python) -and -not (Get-Command python.exe -ErrorAction SilentlyContinue)) {
  throw "Install Python 3.11 x64 from https://www.python.org/downloads/windows/ first."
}
if (-not (Test-Path -LiteralPath $python) -and -not $pythonArguments) { $python = (Get-Command python.exe).Source }

$environmentPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $environmentPython)) {
  & $python @pythonArguments -m venv (Join-Path $PSScriptRoot ".venv")
  if ($LASTEXITCODE -ne 0) { throw "Could not create the face service virtual environment." }
}

& $environmentPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not upgrade pip." }
& $environmentPython -m pip install "fastapi>=0.115,<1" "uvicorn[standard]>=0.34,<1" "Pillow>=11,<13" "numpy>=1.24,<2" "cryptography>=44,<47" "face-recognition-models>=0.3" dlib-bin
if ($LASTEXITCODE -ne 0) { throw "Could not install the face service dependencies." }
& $environmentPython -m pip install --no-deps "face-recognition>=1.3,<2"
if ($LASTEXITCODE -ne 0) { throw "Could not install face-recognition." }

Write-Host "Dependencies installed. Start the service with .\start.ps1"
