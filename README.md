# BEL Cyber Network Operations Status

Local network monitoring dashboard for Windows, built for operational visibility across gateways, remote targets, application endpoints, incidents, uptime, packet loss, and throughput.

- **Developer:** [Amit Kumar](https://github.com/amit-kumar84)
- **Author:** [Amit Kumar](https://github.com/amit-kumar84)
- **Repository:** [amit-kumar84/BEL-LIVE-SERVER](https://github.com/amit-kumar84)
**License:** Dual licensing is available: MIT for the open-source codebase and a commercial option for enterprise or redistributed deployment terms. See [LICENSE](./LICENSE), [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md), and [NOTICE](./NOTICE).

> **Important:** This project is designed for authorized local monitoring only. Configure only systems and networks that you own or are permitted to monitor.

## Highlights

- React 19 + Vite dashboard with a cyber-operations visual system.
- FastAPI monitoring engine with SQLite history and WebSocket telemetry.
- Independent gateway and remote-target reachability states.
- Per-line observed connected-client count from the Windows ARP table.
- ICMP reachability, RTT, packet loss, daily IST uptime, TCP checks, and HTTP(S) health checks.
- Configurable failure/recovery thresholds and incident audio alerts.
- Large visual down/restored alerts synchronized with audio playback.
- SNMPv2c read-only interface counters with Windows network-adapter throughput fallback.
- Per-monitor `RX / TX SPEED` enable/disable control.
- Authenticated monitor configuration and IST-formatted incident CSV export.
- Loopback-only default binding for local operation.

Connected-client counts are labeled **observed** because a generic gateway cannot
expose its complete DHCP/Wi-Fi client list through ARP alone. For an exact
enterprise count, integrate the gateway, DHCP server, wireless controller, or
SNMP vendor-specific client OIDs.

## Requirements

- Windows 10 or Windows 11
- Python 3.11 or newer
- Node.js 20 or newer with npm
- A modern browser (Microsoft Edge is recommended for kiosk mode)
- Network authorization for the configured ICMP, TCP, HTTP(S), and optional SNMP checks

No external database is required. History is stored locally in SQLite.

## Quick start

From the repository root:

```powershell
.\start_dashboard.bat
```

The startup script creates the Python virtual environment, installs backend and frontend dependencies, starts:

- API: <http://127.0.0.1:8000>
- Dashboard: <http://127.0.0.1:5173>

Open <http://127.0.0.1:5173> if the browser does not open automatically.

For Microsoft Edge kiosk mode:

```powershell
.\start_kiosk.bat
```

For the complete Windows Service and automatic full-screen startup setup, see
[COMMAND_GUIDE.md](./COMMAND_GUIDE.md).

The first startup requires internet access to download dependencies. Runtime monitoring does not use a cloud service.

## Manual development startup

Backend:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Frontend, in a second terminal:

```powershell
npm install
npm run dev
```

Health check:

```text
http://127.0.0.1:8000/api/health
```

Expected response:

```json
{"ok":true,"mode":"live","bind":"127.0.0.1"}
```

## First-run administration

Monitor configuration changes require the local administrator password. The generated password is stored in `data\admin.password`. Set `CYBERNOC_ADMIN_PASSWORD` in a private `.env` when an explicit password is required.

Never commit `data\`, `.env`, passwords, logs, or database files. The default server binding is loopback-only; do not change it to `0.0.0.0` without reviewing authentication, CORS, and firewall exposure.

## Configure a monitor

The validated persistent configuration is `data\monitors.json`. The safe example is [config/monitors.example.json](./config/monitors.example.json); its documentation-only addresses are disabled and must be replaced.

For each line:

1. Set **Gateway IP** to the actual router or next-hop address, such as `192.168.31.1`.
2. Set **Remote Target** to an authorized server, application host, or approved external endpoint.
3. Leave **Source Interface IP** empty for Windows route selection, or set the IPv4 address of the intended local NIC when multiple adapters exist.
4. Optionally set **TCP Port** to validate a service such as `443`.
5. Optionally set **HTTP(S) URL** to validate an application health endpoint.
6. Tune interval, timeout, failure, recovery, latency, and packet-loss thresholds.
7. Enable the monitor and save the configuration.

Gateway and remote-target probes are independent. A source IP does not install routes or guarantee provider-specific WAN routing; required routes and policy routing must be provisioned by the network administrator.

## Throughput collection

The `RX / TX SPEED` toggle controls all throughput collection for a monitor:

- **On:** try configured SNMP first; if SNMP is disabled or unavailable, use the selected Windows adapter counters.
- **Off:** disable both SNMP and local fallback; the card displays `N/A`.

SNMP is optional and supports read-only SNMPv2c counters:

```text
SNMP HOST: device or router address
READ-ONLY COMMUNITY: device-configured community
IF INDEX: interface index reported by the device
COUNTER WIDTH: 64-bit when supported
```

The local fallback measures traffic through the monitoring PC, not total router/WAN traffic and not the private bandwidth of a remote target. Remote-target-specific throughput requires working SNMP, a remote agent, or an authorized device API.

## Incident alerts and export

Place authorized MP3/WAV files in `C:\CyberNOC\audio` (open it from the Start Menu shortcut **BEL CyberNOC / Alert Audio Folder**), then map them to each line in Monitor Configuration. Visual alerts work independently of audio.

The configuration drawer provides authenticated incident export by IST date range. CSV output includes incident ID, monitor, down time, recovery time, total downtime, and details, using Excel-friendly UTF-8 output and 12-hour IST timestamps.

## Architecture

```text
React/Vite frontend
        │ HTTP + WebSocket
FastAPI/Uvicorn backend
        │
SQLite history · Windows probes · optional SNMP · local adapter counters
```

## Validation

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm run build
```

## Security and privacy

- The application defaults to `127.0.0.1` and is intended for local use.
- Configuration routes require administrator authentication.
- SNMP requests are read-only; no SNMP writes are issued.
- Keep monitor configuration, passwords, audio, logs, and SQLite data on a restricted local disk.
- Do not expose the API or Vite server publicly without an independent security review.

## License and ownership

This project is delivered under a dual-license model:

- MIT License for the original source code in this repository: [LICENSE](./LICENSE)
- Commercial/enterprise licensing for redistribution, branding, service deployment, or proprietary integration: [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md)

BEL names, marks, logos, and organization-specific materials are not granted under the MIT License. Third-party logos, fonts, icons, and service branding remain the property of their respective owners. See [NOTICE](./NOTICE).

Copyright © 2026 Amit Kumar. This copyright notice covers the original source code authored for this repository and does not override any applicable employment, contract, government, customer, or intellectual-property agreement.

## Developer and author

 - **Developer:** [Amit Kumar](https://github.com/amit-kumar84)
 - **Author:** [Amit Kumar](https://github.com/amit-kumar84)
 - **GitHub:** <https://github.com/amit-kumar84>
