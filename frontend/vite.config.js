import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const keyFile = process.env.VITE_HTTPS_KEY
const certFile = process.env.VITE_HTTPS_CERT
const pfxFile = process.env.VITE_HTTPS_PFX
const https = pfxFile
  ? { pfx: readFileSync(pfxFile), passphrase: process.env.VITE_HTTPS_PFX_PASSWORD || undefined }
  : keyFile && certFile
    ? { key: readFileSync(keyFile), cert: readFileSync(certFile) }
    : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_DEV_HOST || "0.0.0.0",
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    https,
    proxy: {
      "/api": process.env.VITE_API_PROXY || "http://127.0.0.1:4000",
    },
  },
})
