# Smart Attendance

Existing React frontend, Node API, SQLite database, and local FastAPI face service. The student flow is **Login → Dynamic QR → Face match → Backend attendance confirmation**. BLE firmware and screens remain in the repository but are not imported by or required in the active attendance workflow.

Student roll numbers contain 8 characters: the admission year's last two digits, a program code (`BCS` for CSE, `BDA` for DSAI, or `BEC` for ECE), and a three-digit roll number from `000` to `999` (for example, `25BDA090`).

## Start on the development computer

Open three PowerShell terminals.

**Face service** (Windows Python 3.11 x64):

```powershell
cd face-liveness
.\setup-windows.ps1   # only the first time
.\start.ps1
```

The face service binds to `127.0.0.1:5001`; it is called only by the backend. It persists its encryption key and encrypted templates in ignored `face-liveness/data/`.

**Backend:**

```powershell
cd backend
$env:HOST = "0.0.0.0"
$env:PORT = "4000"
$env:FACE_SERVICE_URL = "http://127.0.0.1:5001"
$env:QR_TTL_SECONDS = "30"
$env:STUDENT_ROSTER_RANGE = "001-300"
npm.cmd start
```

Or run `.\start.ps1` from `backend`. For the laptop setup, that script allows any valid `YYBCS`, `YYBDA`, or `YYBEC` roll number ending in `001`–`300`, plus the seeded local accounts. This broad registration range is for local setup; replace it with the institution-approved exact roster before a real deployment. Local demo credentials are documented in [backend setup](backend/README.md).

**Frontend:**

```powershell
cd frontend
$env:VITE_DEV_HOST = "0.0.0.0"
$env:VITE_API_PROXY = "http://127.0.0.1:4000"
npm.cmd run dev
```

Open `http://localhost:5173` on the development computer. The QR scanner and face camera need browser camera permission.

## Use the installable app on a student's phone

1. Run `ipconfig` on the development computer and note its Wi-Fi/Ethernet IPv4 address (for example `192.168.1.20`). Give that address a stable DHCP reservation if possible.
2. Vite and the API bind to `0.0.0.0`. The HTTPS frontend runs on port 5174. If Windows Firewall blocks the phone, run this from an elevated PowerShell; the rule is limited to the local Wi-Fi subnet:

   ```powershell
   New-NetFirewallRule -DisplayName "Smart Attendance HTTPS dev 5174" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5174 -RemoteAddress "192.168.1.0/24" -Profile Any
   ```

   Replace `192.168.1.0/24` with the local network subnet shown by `ipconfig`. Port 4000 only needs a firewall rule if the frontend calls the API directly instead of using the Vite proxy. Keep port 5001 private; the face service should not be exposed to student devices.
3. Phone browsers require HTTPS for camera access on a LAN address. From `frontend`, create a local root and certificate using the IPv4 address found in step 1: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup-lan-https.ps1 -LanAddress 192.168.1.20`. Replace `192.168.1.20` with your development computer's address. Then start the phone-ready frontend with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-lan.ps1`. It serves HTTPS on port 5174. The `.certs` directory is ignored by Git; keep `attendance-root-key.pem` private.
4. Transfer `frontend/.certs/attendance-local-root.crt` to each test phone and install it as a trusted CA certificate. Android: Settings > Security > Encryption & credentials > Install a certificate > CA certificate. iPhone: install the profile, then enable full trust in Settings > General > About > Certificate Trust Settings. The setup script also attempts to trust the root for the current Windows user. On a managed computer or phone, policy may prevent installing a local CA; use an institution-approved HTTPS certificate in that case.
5. On the phone connected to the same Wi-Fi, visit `https://192.168.1.20:5174` (using your development computer's address), log in as a registered and course-enrolled student, and scan the professor's current QR code. Optionally install the app from the browser menu (Safari on iPhone: Share → Add to Home Screen). The frontend proxies `/api` to the backend on the same computer, so students do not need direct access to ports 4000 or 5001 and backend CORS does not need the phone origin for this setup.

Remove the firewall rule after the classroom test if it is no longer needed: `Remove-NetFirewallRule -DisplayName "Smart Attendance HTTPS dev 5174"` (elevated PowerShell).

Configure `VITE_API_URL` only when the phone should call a separately hosted API directly; then set it to that HTTPS API base URL and add the frontend origin to `CORS_ORIGINS`. Never put face-template keys, database credentials, or backend secrets into Vite variables.

## Checks

From `backend`, run `npm.cmd test`. From `frontend`, run `npm.cmd run build`. The face-service health endpoint is `http://127.0.0.1:5001/health`; it is local to the development computer. Attendance face verification compares one camera image with the enrolled template. It does not perform liveness detection or detect photo/video spoofing.
