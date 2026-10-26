# Local face matching service

The FastAPI service enrolls a face template, checks a prompted blink across a short camera-frame sequence, and compares a post-blink frame with the enrolled template. It stores only an AES-GCM encrypted face embedding in `data/templates.sqlite`; it does not retain submitted images. The backend issues a short-lived random blink challenge after QR verification and only accepts the face result when both blink and face matching pass.

## Run on Windows

With Python 3.11 x64 installed, run these commands from this folder:

```powershell
.\setup-windows.ps1
.\start.ps1
```

The Windows setup uses the signed `dlib-bin` wheel because building dlib from source requires Microsoft C++ build tools. The startup script creates and reuses `data/template.key` so encrypted face templates remain readable after a restart. Keep that key private and backed up; losing it makes existing templates unreadable. The service listens on `http://127.0.0.1:5001` by default.

## Private service configuration

The backend sends `Authorization: Bearer <FACE_SERVICE_TOKEN>` to enrollment, enrollment-status, and verification endpoints. The token is optional for laptop development. In production set the same random value (at least 32 characters) as `FACE_SERVICE_TOKEN` in both services, set `NODE_ENV=production`, and set `FACE_DATA_DIR` to an absolute persistent directory. Production startup fails if the shared token or persistent data directory is missing. Keep the face service on private networking; `/health` is intentionally unauthenticated for internal health checks, while biometric endpoints require backend authentication.

## Run with Docker

Set a private 32-byte encryption key and start the service from this folder:

```powershell
$env:FACE_TEMPLATE_KEY = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up --build
```

Keep the key stable across restarts and protect it like a password. Losing it makes existing templates unreadable. The API server connects to the service at `http://127.0.0.1:5001` by default; set `FACE_SERVICE_URL` if it runs elsewhere. The service binds to loopback through Compose and should not be exposed directly to a network.

The application backend must be started with `STUDENT_ROSTER` configured for student registrations. The enrollment page needs camera permission and a supported secure context.

For hosting, set `FACE_DATA_DIR` to the provider's persistent-volume mount, and set a 32-byte `FACE_TEMPLATE_KEY` plus the shared `FACE_SERVICE_TOKEN` through the provider's secret settings. The service accepts the 64-character hex format used by the local setup and URL-safe base64 format. Keep the face-template key unchanged and backed up securely; never expose it to the frontend or students.

## Limits

The service uses the `face_recognition` library with dlib's face and eye landmark models. Blink detection is a basic active liveness cue, not a robust anti-spoof system: a suitably timed replayed video may still pass. The recognition threshold is currently fixed in `service.py` and should be calibrated against a consented validation set before production use. The browser sends a brief sequence of compressed camera frames; the service processes them in memory and does not save them.
