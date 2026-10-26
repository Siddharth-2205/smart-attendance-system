# Local face matching service

The FastAPI service enrolls a face template and compares one captured face image with that template. It stores only an AES-GCM encrypted face embedding in `data/templates.sqlite`; it does not retain the submitted images. Verification checks identity by face match only. It does not perform liveness detection or detect photo/video spoofing.

## Run on Windows

With Python 3.11 x64 installed, run these commands from this folder:

```powershell
.\setup-windows.ps1
.\start.ps1
```

The Windows setup uses the signed `dlib-bin` wheel because building dlib from source requires Microsoft C++ build tools. The startup script creates and reuses `data/template.key` so encrypted face templates remain readable after a restart. Keep that key private and backed up; losing it makes existing templates unreadable. The service listens on `http://127.0.0.1:5001` by default.

## Run with Docker

Set a private 32-byte encryption key and start the service from this folder:

```powershell
$env:FACE_TEMPLATE_KEY = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up --build
```

Keep the key stable across restarts and protect it like a password. Losing it makes existing templates unreadable. The API server connects to the service at `http://127.0.0.1:5001` by default; set `FACE_SERVICE_URL` if it runs elsewhere. The service binds to loopback through Compose and should not be exposed directly to a network.

The application backend must be started with `STUDENT_ROSTER` configured for student registrations. The enrollment page needs camera permission and a supported secure context.

## Limits

The service uses the `face_recognition` library with dlib's face encoding model. This is face recognition only: a printed photograph or replayed video may pass the check. The recognition threshold is currently fixed in `service.py` and should be calibrated against a consented validation set before production use.
