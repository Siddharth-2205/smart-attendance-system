param(
  [Parameter(Mandatory = $true)]
  [string]$LanAddress
)

$ErrorActionPreference = "Stop"
$certDir = Join-Path $PSScriptRoot ".certs"
New-Item -ItemType Directory -Path $certDir -Force | Out-Null

$openssl = (Get-Command openssl.exe -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
  $gitOpenSsl = Join-Path $env:ProgramFiles "Git\usr\bin\openssl.exe"
  if (Test-Path -LiteralPath $gitOpenSsl) { $openssl = $gitOpenSsl }
}
if (-not $openssl) { throw "OpenSSL was not found. Install Git for Windows or OpenSSL, then rerun this script." }

$caKey = Join-Path $certDir "attendance-root-key.pem"
$caCert = Join-Path $certDir "attendance-local-root.crt"
$leafKey = Join-Path $certDir "attendance-lan-key.pem"
$leafCsr = Join-Path $certDir "attendance-lan.csr"
$leafCert = Join-Path $certDir "attendance-lan-cert.pem"
$extensions = Join-Path $certDir "attendance-lan-ext.cnf"

if (-not (Test-Path -LiteralPath $caKey) -or -not (Test-Path -LiteralPath $caCert)) {
  & $openssl req -x509 -newkey rsa:3072 -nodes -keyout $caKey -out $caCert -sha256 -days 1825 -subj "/CN=Smart Attendance Local Development Root" -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" -addext "subjectKeyIdentifier=hash"
  if ($LASTEXITCODE -ne 0) { throw "Could not create the local HTTPS root certificate." }
}

@"
[server_cert]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:$LanAddress,IP:127.0.0.1,DNS:localhost
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
"@ | Set-Content -LiteralPath $extensions -Encoding Ascii

& $openssl req -new -newkey rsa:2048 -nodes -keyout $leafKey -out $leafCsr -sha256 -subj "/CN=$LanAddress"
if ($LASTEXITCODE -ne 0) { throw "Could not create the local HTTPS server key." }
& $openssl x509 -req -in $leafCsr -CA $caCert -CAkey $caKey -CAcreateserial -out $leafCert -days 180 -sha256 -extfile $extensions -extensions server_cert
if ($LASTEXITCODE -ne 0) { throw "Could not sign the local HTTPS server certificate." }

Write-Host "HTTPS certificate created for $LanAddress."
Write-Host "Trust the public root on the phone before opening the site: $caCert"
Write-Host "Keep attendance-root-key.pem private; it can issue replacement certificates."
try {
  Import-Certificate -FilePath $caCert -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
  Write-Host "The root certificate is trusted by this Windows user."
} catch {
  Write-Warning "Windows blocked adding the root to this user's trust store. Import attendance-local-root.crt manually from Windows certificate settings."
}
