import { writeFile } from "node:fs/promises";

const configuredApiUrl = process.env.VITE_API_URL?.trim() || "";
let apiOrigin = "";
if (configuredApiUrl) {
  const parsed = new URL(configuredApiUrl);
  if (parsed.protocol !== "https:" || parsed.origin !== configuredApiUrl.replace(/\/$/, "")) {
    throw new Error("Production VITE_API_URL must be an HTTPS origin without a path, query, or fragment.");
  }
  apiOrigin = parsed.origin;
}

const connectSource = apiOrigin ? `'self' ${apiOrigin}` : "'self'";
const policy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSource}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
].join("; ");

const headers = `/*\n  Content-Security-Policy: ${policy}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(self)\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n`;
await writeFile(new URL("../dist/_headers", import.meta.url), headers, "utf8");
