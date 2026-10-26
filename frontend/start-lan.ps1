$ErrorActionPreference = "Stop"
$keyPath = Join-Path $PSScriptRoot ".certs\attendance-lan-key.pem"
$certPath = Join-Path $PSScriptRoot ".certs\attendance-lan-cert.pem"
if (-not (Test-Path -LiteralPath $keyPath) -or -not (Test-Path -LiteralPath $certPath)) {
  throw "LAN HTTPS certificate missing. Run .\setup-lan-https.ps1 first."
}
$env:VITE_DEV_HOST = "0.0.0.0"
$env:VITE_PORT = "5174"
$env:VITE_API_PROXY = "http://127.0.0.1:4000"
$env:VITE_HTTPS_KEY = $keyPath
$env:VITE_HTTPS_CERT = $certPath
npm.cmd run dev
