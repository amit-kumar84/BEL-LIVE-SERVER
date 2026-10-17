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

## Hindi setup guide (Windows)

### 1. क्या-क्या install करना है

इस application को चलाने के लिए Windows 10/11 PC पर ये software install करें:

1. **Python 3.11 या उससे नया** — <https://www.python.org/downloads/windows/>
   Installation के समय **Add Python to PATH** चुनें। `py --version` से जाँच करें।
2. **Node.js 20 या उससे नया (LTS)** — <https://nodejs.org/>
   इसके साथ npm भी install होता है। `node --version` और `npm --version` से जाँच करें।
3. **Modern browser** — Edge, Chrome या कोई अन्य आधुनिक browser। Kiosk mode के लिए Microsoft Edge उपयोग होता है।

अलग से MySQL, MongoDB या कोई दूसरा database install करने की आवश्यकता नहीं है। History local SQLite file में save होती है। Monitoring के लिए PC को संबंधित network और ICMP/TCP/HTTP targets तक पहुँच की अनुमति होनी चाहिए।

### 2. Project खोलना

Project folder को PC पर copy/clone करें, फिर PowerShell में उसी folder में जाएँ:

```powershell
cd "C:\Users\YourName\Downloads\BEL-LIVE-SERVER"
```

Folder में `start_dashboard.bat`, `backend`, `src`, `package.json` और `backend\requirements.txt` मौजूद होने चाहिए।

### 3. सबसे आसान start तरीका

Project folder में [start_dashboard.bat](./start_dashboard.bat) पर double-click करें, या PowerShell में चलाएँ:

```powershell
.\start_dashboard.bat
```

पहली बार start होने पर script अपने-आप:

- `.venv` नाम का Python virtual environment बनाएगी।
- `backend\requirements.txt` की Python dependencies install करेगी।
- `package.json` की npm dependencies install करेगी।
- API को `http://127.0.0.1:8000` पर start करेगी।
- Dashboard को `http://127.0.0.1:5173` पर start करेगी।
- Browser खोलने की कोशिश करेगी।

पहली बार internet चालू रखें, क्योंकि packages download होंगे। Start होने के बाद dashboard खोलने का address है:

<http://127.0.0.1:5173>

Full-screen wall display के लिए [start_kiosk.bat](./start_kiosk.bat) चलाएँ:

```powershell
.\start_kiosk.bat
```

### 4. अगर batch file से start न हो तो manual start

PowerShell की दो windows खोलें। पहली window में backend चलाएँ:

```powershell
cd "C:\Users\YourName\Downloads\BEL-LIVE-SERVER"
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

दूसरी window में frontend चलाएँ:

```powershell
cd "C:\Users\YourName\Downloads\BEL-LIVE-SERVER"
npm install
npm run dev
```

फिर browser में <http://127.0.0.1:5173> खोलें। दोनों windows बंद करने पर संबंधित services बंद हो जाएँगी।

### 5. Backend health check

यह address browser में खोलें:

<http://127.0.0.1:8000/api/health>

सही स्थिति में response इस प्रकार होगा:

```json
{"ok":true,"mode":"live","bind":"127.0.0.1"}
```

`127.0.0.1` का अर्थ है कि application केवल इसी PC पर accessible है। इसे `0.0.0.0` पर bind न करें, जब तक authentication, CORS और firewall की अलग security review न हो।

### 6. पहली बार admin login

Default password है:

```text
hactor@3200
```

यह password [data/admin.password](./data/admin.password) में रहता है और configuration drawer खोलने के लिए उपयोग होता है। Setup के बाद इस file का password बदलें, या project root में private `.env` file बनाकर strong password रखें:

```env
CYBERNOC_ADMIN_PASSWORD=अपना-मजबूत-private-password
```

`.env` और `data\admin.password` किसी दूसरे व्यक्ति को न दें और GitHub पर upload न करें।

### 7. Real network monitors configure करना

पहली बार backend start होने पर [data/monitors.json](./data/monitors.json) बनती है। Example values [config/monitors.example.json](./config/monitors.example.json) में हैं। Example monitors disabled हैं और documentation-only IP addresses उपयोग करते हैं; उनसे real monitoring नहीं होगी।

Configuration drawer में प्रत्येक monitor के लिए:

1. `gateway_ip` में वास्तविक line/router gateway डालें।
2. `target` में वास्तविक reachable server/service डालें।
3. SAP/intranet के लिए approved internal application host चुनें।
4. Internet के लिए organization-approved stable endpoint चुनें।
5. Service check के लिए `tcp_port` या `http_url` configure करें।
6. सही `interval`, failure threshold और recovery threshold रखें।
7. Monitor को **enabled** करें और configuration save करें।

`source_ip` खाली रखने पर Windows अपनी current route selection उपयोग करेगा। `source_ip` किसी route को install नहीं करता और remote traffic को अपने-आप किसी खास WAN से force नहीं करता। Per-WAN monitoring के लिए network administrator को Windows route/metric या network-side policy routing configure करनी होगी। Application routes या firewall settings में बदलाव नहीं करती।

### 8. Optional SNMP और audio

Throughput के लिए SNMP enable करना हो तो router का host, UDP port, interface index और read-only community configure करें। SNMPv2c इस implementation में supported है; dedicated read-only credential उपयोग करें और router पर monitoring PC तक access सीमित रखें। Application SNMP write requests नहीं भेजती।

Audio alerts के लिए यह folder बनाएँ:

```text
C:\CyberNOC\audio
```

इसमें MP3/WAV files रखें और configuration drawer से DOWN, REPEAT और RECOVERED recordings चुनें। Browser autoplay रोक सकता है, इसलिए dashboard पर एक बार click/tap करके audio arm करें। Visual alerts audio के बिना भी काम करते हैं।

### 9. Logs और troubleshooting

Batch startup के logs project folder में मिलेंगे:

- `backend.log` — FastAPI/Uvicorn errors
- `frontend.log` — Vite errors

अगर Python नहीं मिल रहा हो:

```powershell
py --version
```

अगर Node/npm नहीं मिल रहा हो:

```powershell
node --version
npm --version
```

अगर port व्यस्त हो:

```powershell
Get-NetTCPConnection -LocalPort 8000
Get-NetTCPConnection -LocalPort 5173
```

अगर readings नहीं आ रही हों तो monitor enabled है या नहीं, IP addresses सही हैं या नहीं, और Windows/network firewall ICMP/TCP/HTTP traffic block तो नहीं कर रहा है—यह जाँचें। ICMP blocked होने पर TCP/HTTP health check अधिक उपयोगी हो सकता है।

### 10. Tests और production build

Backend tests चलाने के लिए:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
```

Frontend production build जाँचने के लिए:

```powershell
npm run build
```

### 11. रोज़ application चलाने का तरीका

1. PC पर project folder खोलें।
2. `start_dashboard.bat` चलाएँ।
3. Dashboard के लिए <http://127.0.0.1:5173> खोलें।
4. काम समाप्त होने पर backend/frontend की command windows बंद करें।

Windows login पर automatic kiosk startup चाहिए तो `start_kiosk.bat` का shortcut बनाकर `shell:startup` folder में रखें। इसे administrator के रूप में चलाने की सामान्यतः आवश्यकता नहीं है।

### 12. Full-screen voice alert

जब configured DOWN या RECOVERED audio वास्तव में play होता है, dashboard के ऊपर hacker/future-tech style का transparent floating alert दिखाई देता है:

- लाल animated `WARNING // SERVER DOWN` — server/line down होने पर।
- हरा animated `SERVER RESTORED` — service वापस आने पर।
- Alert में संबंधित monitor का नाम और telemetry status दिखता है।
- Audio समाप्त होने पर floating message अपने-आप हट जाता है।

Browser autoplay policy के कारण पहली बार dashboard पर click/tap करना आवश्यक है। Audio file configured न होने या audio play न होने पर गलत visual alert नहीं दिखाया जाता। Floating alert card wall display पर बड़ा transparent panel, बड़ा status text, wider neon glow और mobile-responsive sizing के साथ दिखाई देता है।

### 13. Compact NOC dashboard UI

Dashboard को 16:9 wall display और desktop NOC use के लिए compact किया गया है। Header में BEL icon/favicon, condensed telemetry bar, tighter monitor cards और reduced empty spacing हैं। प्रत्येक line card में gateway के लिए Wi‑Fi icon और remote target के लिए signal icon दिखाई देता है:

- Green — endpoint reachable
- Red — endpoint not responding
- Amber — अभी sample उपलब्ध नहीं

Gateway और remote target की status checks independent हैं। Gateway का `REACHABLE`/`NO RESPONSE` text और icon केवल gateway probe से बदलता है; remote target का text और icon केवल target probe से बदलता है। इसलिए एक endpoint down होने पर दूसरे endpoint का status गलत तरीके से नहीं बदलेगा।

Card entrance animation, neon borders, scanline/grid background और state-based green/red chart accents live monitoring को जल्दी पढ़ने में मदद करते हैं। छोटे screens पर layout अपने-आप single-column flow में बदल जाता है।

### 14. Custom line और incident export

Monitor configuration में **OTHER** monitor type चुनकर `CUSTOM LINE TYPE` में कोई भी label लिख सकते हैं, जैसे `VPN`, `MPLS`, `CCTV` या `DR LINK`। Display name और custom type दोनों save होकर dashboard पर दिखते हैं।

Header के download icon से incident logs CSV में export किए जा सकते हैं:

1. Configuration drawer खोलें।
2. `FROM` और `TO` dates चुनें।
3. `EXPORT EXCEL CSV` दबाएँ।
4. Admin login आवश्यक होने पर उसी drawer में sign in करें।

Export में प्रत्येक outage की एक Excel-friendly row होती है: `Down At (IST)`, `Recovered At (IST)`, `Total Downtime` और `Detail`। सभी times Indian Standard Time में `AM/PM` format में हैं। Date range अधिकतम 366 दिन की है।

Metric colors:

- RTT और packet loss normal होने पर green, warning threshold पार करने पर yellow और threshold के दोगुने पर red।
- 24-hour uptime `99%+` पर green, `95–99%` पर yellow और `95%` से नीचे red।
- Gateway और remote target दोनों में वही signal icon उपयोग होता है: reachable green, no response blinking red और no sample amber।

Loss indicator behavior:

- `0–35%` loss — green normal Wi‑Fi icon
- `36–65%` loss — yellow Wi‑Fi icon
- `66–100%` loss — red Wi‑Fi icon
- Any line-down state — red disabled Wi‑Fi icon, regardless of the last numeric loss sample

Loss और displayed daily uptime एक-दूसरे से जुड़े हैं और हमेशा कुल 100% बनाते हैं। Daily calculation हर भारतीय calendar day के `12:00 AM (IST)` से शुरू होती है, इसलिए दो मिनट का outage भी उसी दिन के uptime में शामिल होता है:

```text
UPTIME = 100 - LOSS
```

इसलिए यदि loss `35%` है तो uptime `65%` दिखेगा, और यदि loss `80%` है तो uptime `20%` दिखेगा। Monitoring samples के बीच का समय weighted रूप से calculate होता है; last sample से current time तक का interval भी शामिल है। Uptime के colors उलटे हैं:

- `0–35%` uptime — red
- `36–65%` uptime — yellow
- `66–100%` uptime — green

जब target का packet-loss sample उपलब्ध नहीं होता, दोनों metrics `---` दिखाते हैं; इस स्थिति में fabricated uptime नहीं दिखाया जाता।