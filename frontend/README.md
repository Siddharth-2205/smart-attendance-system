# Smart Attendance frontend

Start the Vite app from this folder with `npm.cmd run dev`. It serves on port 5173 and proxies `/api` to `http://127.0.0.1:4000` by default. Set `VITE_API_URL` for a direct API base URL; that API origin must be listed in backend `CORS_ORIGINS`.

Useful development settings:

- `VITE_DEV_HOST=0.0.0.0` lets a phone on the classroom LAN open the development app.
- `VITE_API_PROXY=http://127.0.0.1:4000` selects the backend for the Vite proxy.
- `VITE_HTTPS_KEY` and `VITE_HTTPS_CERT` enable HTTPS using a trusted development certificate. HTTPS is needed for camera access on other devices.

The student attendance sequence is login, server-validated dynamic QR scan, a short prompted blink challenge with 10–16 camera frames, enrolled-face matching, and backend-confirmed success. Blink is only a basic liveness cue; it does not provide robust protection from photo/video spoofing. See [network setup and commands](../README.md).

For a production Netlify build, set `VITE_API_URL` to the exact HTTPS API origin (for example, `https://api.example.edu`, with no path), then run `npm run build`. The build writes Netlify `_headers` with a content security policy restricted to that API origin and standard browser security headers. `VITE_API_URL` is public configuration, not a secret. Never place database paths, passwords, `FACE_SERVICE_TOKEN`, or `FACE_TEMPLATE_KEY` in Vite variables.

## Install on a phone

The production frontend includes an installable Progressive Web App shell. Host the production build over HTTPS, open it on the phone, and add it to the home screen from the browser menu. Android Chrome offers **Install app** or **Add to Home screen**; on iPhone/iPad, use Safari's **Share → Add to Home Screen**. The app shell and static files may load from cache, but sign-in, QR validation, face matching, and attendance recording require a live connection to the backend and face service. The service worker deliberately does not cache API responses. Vite's development server does not register the service worker.
