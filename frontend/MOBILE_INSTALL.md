# Use Smart Attendance on a phone

The production frontend can be installed as a Progressive Web App on Android and iPhone. Build and host the frontend over HTTPS, then open its URL on the phone. In Android Chrome, choose **Install app** or **Add to Home screen**. On iPhone, open the URL in Safari and choose **Share → Add to Home Screen**.

For a classroom LAN setup from this laptop, follow the HTTPS certificate and startup steps in the repository [README](../README.md). Trust the development certificate on the phone before opening the site so browser camera access works.

The production service worker can cache the frontend shell and static files. It does not cache API responses, so sign-in, QR validation, face matching, and attendance recording still require a connection to the backend and face service. The Vite development server does not register the service worker.
