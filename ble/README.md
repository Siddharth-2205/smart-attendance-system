# ESP32-C3 attendance beacon

This prototype uses an ESP32-C3 running the firmware in `esp32-c3/`. It exposes a GATT challenge characteristic and a read-only response characteristic. The server sends a random 128-bit nonce; the beacon returns an HMAC-SHA256 response. The Node API accepts attendance proximity only after verifying that response with the per-beacon key.

## Provision and flash

1. Install PlatformIO Core or the VS Code PlatformIO extension and connect an ESP32-C3 DevKit board.
2. Copy `esp32-c3/include/credentials.example.h` to `esp32-c3/include/credentials.h`.
3. Set a unique beacon ID and a random 32-byte (64 hexadecimal character) key in `credentials.h`. The ID must match the class `beaconId` in the API data.
4. Build and upload from `esp32-c3/` with `pio run -t upload`.
5. Configure the same key in the API process as `BEACON_KEYS`, a JSON object mapping beacon IDs to hexadecimal keys.

Example PowerShell key generation:

```powershell
$key = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$env:BEACON_KEYS = '{"BLE-CS301":"' + $key + '"}'
```

Use the same `$key` value in the device's ignored `credentials.h`. Never commit that file or the `BEACON_KEYS` value. Provision a different key for each physical beacon.

The student flow uses Web Bluetooth, which requires a supported browser, a secure context (HTTPS, or localhost during development), Bluetooth permission, and access to a physical beacon. This is a prototype; radio range and relay resistance require testing with the actual board and classroom layout.
