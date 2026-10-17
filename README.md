# BEL CyberNOC

BEL CyberNOC is a local Windows 10/11 network operations dashboard for Bharat Electronics Limited (BEL), Kotdwara. Developed by Amit Kumar ([GitHub: Amit-Kumar-84](https://github.com/Amit-Kumar-84)).

Copyright (c) 2026 Amit Kumar. All rights reserved, subject to applicable BEL employment, contract, and intellectual-property agreements. This notice records the requested author attribution; it does not determine or transfer ownership under any such agreement.

The UI adapts the actual Cry No AI visual system inspected in `C:\Users\ASUS\Downloads\Cry-No-Ai2.0-working\Cry-No-Ai2.0-working\frontend`: void-black surfaces (`#030305`, `#0A0A0F`), cyan/red/green state colors, Rajdhani display text, JetBrains Mono telemetry, fine grid and scanline texture, thin borders, and clipped panel corners. The original Cry No AI project has not been modified.

The operational layout is designed for a 16:9 wall display and fits four monitor cards, summary metrics, events, and local backend state in a 1080p/4K viewport. Smaller desktop/mobile widths use a vertically flowing layout. Visual glow and motion are restrained for sustained viewing.

## Start on Windows

Requirements: Windows 10/11, Python 3.11+, Node.js 20+, npm, and a network account permitted to run ICMP probes. `start_dashboard.bat` creates `.venv`, installs pinned backend dependencies and npm dependencies once, starts the API on `127.0.0.1:8000` and Vite on `127.0.0.1:5173`, checks readiness, then opens the dashboard. The first start requires internet access to download packages; runtime monitoring itself uses no cloud service.

Run `start_dashboard.bat` for a normal browser or `start_kiosk.bat` for Edge kiosk/full-screen mode. Open `http://127.0.0.1:5173`. The first-run admin password is `hactor@3200`; it is stored in `data/admin.password` and unlocks the configuration drawer. Change this shared default after setup by replacing the password file value, or set `CYBERNOC_ADMIN_PASSWORD` in a private `.env`. Restrict access to these files. The application makes no inbound LAN listener and requires no Windows firewall rule. Do not change the bind address without separately reviewing authentication, CORS, and firewall exposure.

For Windows startup, create a shortcut to `start_kiosk.bat` in the signed-in account's Startup folder (`shell:startup` from Run). Avoid configuring a service or running as an administrator unless your network operations policies require it. Do not put the admin password in a shortcut or command line.

## Monitor configuration

The persistent validated configuration is `data/monitors.json`; the schema/example is `config/monitors.example.json`. On first startup, the example is copied into the data directory. It contains four disabled RFC 5737 documentation-only examples (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), so no example endpoints are probed and no sample measurements are shown. Replace all four before relying on the display. Configuration edits in the admin drawer validate and atomically persist JSON, then restart monitoring tasks.

1. Replace each `gateway_ip` with the actual line gateway address.
2. Replace each `target` with a real reachable remote host or service endpoint. For SAP/intranet, choose an approved internal application host; for internet, choose a stable organization-approved external endpoint.
3. Keep `source_ip` empty to probe using Windows' current route selection, or set it to the IPv4 address assigned to the Windows NIC attached to that line. `ping -S` selects the source address, but does **not** install a route or guarantee that a router sends the packet over a particular WAN. The gateway probe is an independent test; the remote probe is not forced through that gateway automatically. If each provider must carry a specific remote probe, the network administrator must configure an appropriate pre-existing Windows route/route metric or network-side policy routing. BEL CyberNOC never adds routes or changes company routing/firewall settings.
4. Select `tcp_port` to verify an application port, or `http_url` for an HTTP(S) health endpoint. TCP/HTTP checks distinguish service failure from host reachability when ICMP is allowed/denied or the app is separately unavailable.
5. Set failure/recovery thresholds and interval for the site's tolerance. Packet loss is a rolling window of up to 20 target pings; uptime is the measured share of successful target pings in stored samples over 24 hours. No history means `---`, not a fabricated percentage.
6. For interface throughput, enable SNMP, configure router `host`, UDP port, interface index, and a read-only community. Prefer SNMPv3 on the device/network, but this initial implementation supports SNMPv2c read-only community only. Provide a dedicated read-only credential and restrict it to the monitoring PC on the router. Configure IF-MIB HC counters where available (64-bit) or legacy 32-bit counters. If the device/interface does not support the requested OIDs, the UI shows N/A. Counter reset yields N/A for that interval; wraparound is handled when counters roll over near their maximum. No SNMP writes are sent.
7. Place MP3/WAV recordings in `C:\CyberNOC\audio`, then choose DOWN, REPEAT, and RECOVERED recordings independently for each monitor in the drawer. Set each monitor's repeat interval in minutes (1–1440; default 30), for example 40, 60, 120, or 300. The repeat recording plays at that interval while its incident remains down; recovery stops repeat alerts. Use each audio test button to confirm playback. Browsers block autoplay until user interaction; click/tap the dashboard once to arm queued announcements. Visual alerts do not depend on audio.

The simulation preview is front-end-only: it changes the first two cards' visual states and queues their configured voice clips as simulated DOWN then RECOVERED. It never changes live readings, writes history, or sends probes. A SIMULATION PREVIEW banner labels the mode. Exit with **SIM RECOVER** to restore live card state.

## Probe and routing behavior

ICMP uses the Windows `ping` utility with one echo per configured interval and the configured timeout. Gateway and target are probed independently. The UI identifies gateway, upstream/target, and TCP/HTTP application failures separately in the incident detail. These conclusions depend on router/host ICMP policy: a device that blocks echo can appear unreachable even when its application works, so use TCP/HTTP checks for that service. Windows firewall policy or endpoint security may also block probes; BEL CyberNOC does not alter those settings. Source-interface binding does not equal per-WAN policy routing; ask the network administrator to provision and verify any required routes. No elevation is needed for the standard Windows ping command.

## Security and local data

FastAPI binds to loopback only, permits only the local Vite origins, validates host/IP/port/audio fields, restricts WebSocket host/origin, and requires a generated local admin password for configuration changes. Audio serving accepts plain MP3/WAV filenames resolved under the configured audio root. Monitor history/events are in `data/cybernoc.sqlite3`; monitor settings and the generated password are in `data/`. Keep these files on a user-restricted local disk. API logs avoid credential values. No SNMP community or audio content is committed to the example configuration.

Optional environment values are shown in `.env.example`. `CYBERNOC_AUDIO_DIR` changes the local audio folder; `CYBERNOC_DATA_DIR` changes the settings/history/password folder. Set a strong `CYBERNOC_ADMIN_PASSWORD` in a private `.env` only if required by local operations; otherwise use the randomly generated password file. Do not expose Uvicorn/Vite on `0.0.0.0`./4*

## Development and tests

```powershell
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r backend\requirements.txt
npm install
npm run dev
.venv\Scripts\python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Run backend checks with `.venv\Scripts\python -m pytest backend\tests -q`; run the frontend production check with `npm run build`. The test suite covers monitor input validation, failure/recovery thresholds, bandwidth rollover/reset, audio path confinement, event identity deduplication, and local API authorization/validation behavior.