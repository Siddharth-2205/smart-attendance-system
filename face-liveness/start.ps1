param(
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 5001
)

$ErrorActionPreference = "Stop"
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  throw "Face service dependencies are not installed. Run .\setup-windows.ps1 first."
}

$dataDirectory = Join-Path $PSScriptRoot "data"
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$keyPath = Join-Path $dataDirectory "template.key"
if (-not (Test-Path -LiteralPath $keyPath)) {
  $keyBytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($keyBytes) } finally { $generator.Dispose() }
  $key = [BitConverter]::ToString($keyBytes).Replace("-", "").ToLowerInvariant()
  [IO.File]::WriteAllText($keyPath, $key, [Text.Encoding]::ASCII)
}

$templateKey = (Get-Content -LiteralPath $keyPath -Raw).Trim()
if ($templateKey -notmatch "^[a-fA-F0-9]{64}$") {
  throw "The saved face-template key is invalid. Check data\template.key."
}

$env:FACE_TEMPLATE_KEY = $templateKey
$env:FACE_DATA_DIR = $dataDirectory
& $python -m uvicorn service:app --app-dir $PSScriptRoot --host $HostAddress --port $Port
exit $LASTEXITCODE
