# RISTV STB Monitor

A small Node.js app for monitoring RISTV set-top boxes. It pings each STB, shows online/offline status on a dashboard, records events, sends optional SMTP email alerts, and exposes ADB actions for remote management.

## Features

- Live dashboard with total, online, offline, and average latency metrics
- Periodic ping checks for each configured STB
- Offline email alerts with cooldown control
- ADB connect, disconnect, reboot, shell, and property lookup endpoints
- JSON-backed device and event storage in `data/`
- No runtime npm dependencies

## Run

```powershell
copy .env.example .env
npm start
```

Open `http://localhost:3000`.

## Configure

Edit `.env`:

```text
APP_TITLE=STB Monitor
PORT=3000
MONITOR_INTERVAL_MS=30000
PING_TIMEOUT_MS=3000
ALERT_COOLDOWN_MS=900000
LOG_RETENTION_DAYS=30
ADB_PATH=adb
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=alerts@example.com
SMTP_PASS=change-me
SMTP_FROM="RISTV STB Monitor <alerts@example.com>"
ALERT_TO=ops@example.com,noc@example.com
```

Email alerts are skipped until `SMTP_HOST` and `ALERT_TO` are configured.

## ADB setup

Install Android Platform Tools and make sure `adb` is available in `PATH`, or set `ADB_PATH` to the full executable path.

For each STB, enable ADB over TCP and set the dashboard ADB target as:

```text
192.168.1.50:5555
```

Useful API examples:

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/devices/demo-lobby/adb/connect -Body "{}" -ContentType "application/json"
Invoke-RestMethod -Method Post http://localhost:3000/api/devices/demo-lobby/adb/reboot -Body "{}" -ContentType "application/json"
Invoke-RestMethod -Method Post http://localhost:3000/api/check -Body "{}" -ContentType "application/json"
```
