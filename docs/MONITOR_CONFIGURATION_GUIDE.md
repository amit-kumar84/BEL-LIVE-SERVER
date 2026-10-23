# Monitor Configuration Guide

## Purpose

Use this guide to add and configure a network line, server, or application endpoint in BEL CyberNOC. It explains what to enter, what each option controls, and how to verify that the resulting dashboard readings mean what you expect.

Configure only networks and services that your organization owns or is authorized to monitor. Replace all example values with approved values from your network team before enabling a monitor.

## Before You Start

Collect these details from the network or application owner:

- A display name for the line or service.
- The gateway IP address for the monitoring path.
- A remote target IP address or DNS hostname that should respond.
- The local network adapter IP to use, if the monitoring PC has multiple adapters or routes.
- An optional TCP port or HTTP(S) health-check URL.
- The desired check interval, timeout, and alert thresholds.
- If using SNMP, the device management IP/name, UDP port, read-only community, and interface index when throughput counters are required.
- The approved down, recovery, and optional reminder audio files.

The `192.0.2.x`, `198.51.100.x`, and `203.0.113.x` ranges are documentation-only examples. They are not real endpoints for your network.

## Open and Save Monitor Configuration

1. Open the dashboard and choose **Monitor configuration**.
2. Sign in with the local administrator account. Configuration changes require authentication.
3. Select an existing monitor, or choose **NEW MONITOR**.
4. Fill in the relevant fields below. Optional fields can remain blank when the feature is not used.
5. Choose **ADD MONITOR** for a new entry or **SAVE CHANGES** for an existing one.
6. Confirm that the monitor appears in the dashboard and that its status changes after checks begin.

Saving a monitor sends the configuration to the local backend, which validates it and restarts/reconfigures the applicable monitoring task. A saved configuration does not guarantee that the selected target responds or that the network permits the probe.

## Line Parameters

| Field | What to enter | What it controls |
| --- | --- | --- |
| **Display name** | A short recognizable name, up to 80 characters. Example: `Branch Internet - East`. | The label shown on the monitor card and in incident records. |
| **Monitor type** | `SAP / INTRANET`, `INTERNET LINE`, `SERVER`, or `OTHER`. | Classification for operators. It does not change how the probes work. |
| **Custom line type** | Required only for `OTHER`; up to 40 characters. Example: `MPLS BACKUP`. | The custom classification displayed on the card. |
| **Enabled** | On to run checks; off to keep the configuration but stop its monitor task. | Controls whether the backend runs probes for this monitor. |
| **Gateway IP** | The IP address of the router/next hop used by this monitoring path. Required. | The gateway is probed independently from the remote target. Must be an IP address, not a DNS name. |
| **Remote target** | An authorized IP address or DNS hostname expected to respond beyond the gateway. Required. | Used for reachability, latency, packet-loss observations, and optional application checks. |
| **Mask gateway / target IP on wall display** | Turn on to obscure the displayed IP addresses. | A display/privacy option for the wall dashboard; it does not change probes or saved monitor addresses. |
| **Interval (sec)** | How often to start a check cycle. Allowed: 2-300 seconds. Default: 5. | Shorter intervals detect changes sooner but create more probe traffic and can make transient issues more visible. |
| **Timeout (ms)** | How long a probe waits for a response. Allowed: 100-15,000 ms. Default: 1,200. | A response later than this is treated as a failed attempt. Increase it only when the path normally has higher latency. |
| **Source interface IP** | Optional IPv4 address assigned to a local adapter on the monitoring PC. | Binds supported probes to that local address. Leave blank for normal Windows route selection. This does not create routes or guarantee a provider-specific path. |

### Choosing a Gateway and Target

- Use the actual next-hop/router IP for **Gateway IP**, not the ISP's public DNS address unless that address is genuinely the configured next hop.
- Use a stable, approved remote target for **Remote target**. Prefer an organization-controlled server or approved service health endpoint where possible.
- A gateway responding while the remote target fails usually points to a problem beyond the local gateway, but does not by itself identify the cause.
- A failed ping can mean the device/path is down or that a firewall blocks ICMP. Use TCP or HTTP(S) checks when the service, rather than ICMP, is the key requirement.

## Failure, Recovery, and Performance Thresholds

| Field | Accepted value and default | Meaning |
| --- | --- | --- |
| **Down after N failures** | 1-20; default 3. | Number of consecutive failed check results before a down incident is created. At a 5-second interval and threshold 3, expect approximately three check cycles before a down alert; actual timing also depends on timeout and check work. |
| **Recover after N OK** | 1-20; default 2. | Number of consecutive successful checks required before a down monitor is marked recovered. This prevents a single reply from clearing a persistent outage. |
| **Latency warning (ms)** | Greater than 0 and at most 60,000; default 150. | A successful target response above this threshold can mark the line degraded. Choose a value appropriate to the target and path. |
| **Packet-loss warning (%)** | 0-100; default 5. | If recent target-probe loss reaches this threshold, an otherwise online line can be marked degraded. The value is derived from a rolling window of recent checks, not a carrier-provided statistic. |

The dashboard's packet-loss reading is not the same as daily downtime. Daily uptime is calculated separately from stored reachability samples. Because checks are periodic, very short interruptions between checks may not be recorded.

## Optional Application Checks

| Field | What to enter | Use it for |
| --- | --- | --- |
| **TCP port** | Optional port from 1-65,535. Example: `443`. | Checks whether a TCP connection to the remote target and port can be opened. Use the service's actual listening port. |
| **HTTP(S) URL** | Optional full URL beginning with `http://` or `https://`, including a hostname. Example: `https://service.example/health`. | Sends an HTTP GET and treats a response below status 400 as reachable. Use a health endpoint that is safe to request periodically. |

These checks supplement gateway and target ICMP probes. HTTP(S) checks currently connect directly; they do not use a configured corporate proxy. If outbound access is proxy-only, this check can fail even when a browser using the company proxy works.

## Throughput Collection

### RX / TX SPEED toggle

- **On:** the backend tries configured SNMP interface counters first. If SNMP is disabled or unavailable, it falls back to the monitoring PC's Windows adapter counters.
- **Off:** throughput collection is disabled and the card shows `N/A` for RX/TX.

The Windows fallback measures traffic through the monitoring computer. It is not the total bandwidth of the router, WAN line, or a remote target. To measure a router interface, configure SNMP and select the correct interface index.

### SNMP RX/TX fields

To use SNMP for throughput, turn on **ENABLE SNMP RX / TX COUNTERS** and enter:

| Field | What to enter | Important detail |
| --- | --- | --- |
| **SNMP host** | Management IP address or hostname of the router/switch. | This is where the SNMP request is sent. It is separate from the monitored remote target. |
| **SNMP port** | UDP port on the management device. Default: 161. Allowed: 1-65,535. | The device/firewall must allow requests from the monitoring PC. |
| **Read-only community** | The community configured on that device for read-only access. | It must match the device. SNMPv2c does not encrypt this value; restrict network access and file permissions. The UI masks typing, but the local configuration file stores the value without encryption. |
| **IF index** | The numeric interface index for the router/switch port to measure. | Required for counters. Select the WAN/LAN interface that represents the traffic you intend to measure. An incorrect index can show unrelated traffic. |
| **Counter width** | 64-bit by default; choose 32-bit only if the device/interface requires it. | 64-bit high-capacity counters are preferred on modern equipment. |

SNMP throughput reads standard interface counters. The application does not configure the router, write SNMP values, or infer the correct interface index automatically.

## Observed Device Count

### SHOW ... NODE COUNT toggle

This controls whether the node-count badge is shown on the monitor card. It is a display toggle, not a guarantee of inventory completeness. The backend can still collect node-count data when the badge is hidden.

### ENABLE SNMP DEVICE COUNT toggle

When enabled, enter the SNMP host, port, and read-only community. An interface index is not required for device discovery alone. The backend tries standard IP-MIB neighbor tables and BRIDGE-MIB/Q-BRIDGE-MIB learned MAC tables, deduplicates MAC addresses, and refreshes approximately once per minute.

If the device does not expose a supported table or the SNMP request fails, the backend falls back to the monitoring PC's Windows ARP cache. The card identifies the source as SNMP-observed or ARP-observed.

Interpret this as an **observed estimate**, not a guaranteed total of every device. ARP may miss quiet devices or other VLANs and can temporarily retain stale entries. Switch/AP/router tables differ by model, configuration, VLAN, and permissions. For authoritative inventory, use the organization's DHCP server, wireless controller, or network-management platform.

## Voice Alerts and Reminders

| Field | What to select | What happens |
| --- | --- | --- |
| **Down alert** | MP3/WAV file, or `NO AUDIO`. A default is selected on new monitors. | Played when the monitor crosses its down threshold, unless set to `NO AUDIO`. |
| **Recovery alert** | MP3/WAV file, or `NO AUDIO`. A default is selected on new monitors. | Played when the monitor meets its recovery threshold, unless set to `NO AUDIO`. |
| **Repeat alert audio** | Optional MP3/WAV file, or `NO AUDIO`. | Played for reminders while a down incident remains open. |
| **Repeat every (minutes)** | 1-1,440; default 30. | Sets the reminder cadence. A reminder sound requires a repeat audio file to be selected. |

The packaged app uses `C:\CyberNOC\audio`. Audio files must be valid MP3/WAV files, no longer than 60 seconds; uploads are limited to 20 MB. Use the upload button to add a file, then test it with the audio button. After changing a monitor's mapping, save the monitor configuration. The visual floating alert is triggered with down/recovery audio playback; audio can still be blocked by Windows device volume or system policy.

## Recommended Setup Recipes

### Internet line availability

1. Set a clear name and choose **INTERNET LINE**.
2. Set the actual line gateway IP and a stable approved remote target.
3. Enable the monitor. Start with the defaults: 5-second interval, 1,200 ms timeout, 3 failures, 2 successes.
4. Add TCP port 443 only if you also want to test a service accepting HTTPS connections. Use an HTTP(S) URL only if a suitable health endpoint exists.
5. Enable RX/TX and configure SNMP only if you need the router's interface throughput. Without SNMP, RX/TX describes the monitoring PC adapter.
6. Select down/recovery audio and save.

### Server reachability and application availability

1. Choose **SERVER** and enter the server IP/DNS name as the target.
2. Set the gateway for the local route to that server.
3. Use a TCP port for a simple port-acceptance test, or an HTTP(S) health URL for an application-level response test.
4. Set thresholds based on the server's expected response time and maintenance behavior.
5. Save and verify that both the gateway and target report the expected status.

### SNMP interface throughput and device observations

1. Obtain the approved management IP, UDP port, read-only community, and interface index from the network administrator.
2. Enable **RX / TX SPEED** and **ENABLE SNMP RX / TX COUNTERS**; enter SNMP host, port, community, interface index, and counter width.
3. If device observations are also required, enable **SNMP DEVICE COUNT**. No interface index is required for that feature.
4. Confirm the device permits read-only SNMP from the monitoring PC and exposes the relevant standard tables.
5. Save, then check that the dashboard reports SNMP as the count source. If it reports ARP, the configured device did not provide usable standard-table data.

## Common Problems and Checks

| Symptom | Check |
| --- | --- |
| Monitor stays `UNKNOWN` | Confirm the monitor is enabled and saved; wait for the first probe; inspect the target and gateway values. |
| Gateway is online but target is down | Verify the remote target and route beyond the gateway; check whether ICMP is filtered. Add an authorized TCP/HTTP check if appropriate. |
| Line becomes degraded unexpectedly | Review recent target latency/loss, warning thresholds, timeout, and whether the target rate-limits ICMP. |
| Down alert is delayed | Down requires the configured number of consecutive failed cycles. Consider interval, timeout, and failure threshold together. |
| RX/TX shows `N/A` or unexpectedly low traffic | Confirm RX/TX is enabled, SNMP is reachable, community and interface index are correct, and whether the card is using the local-adapter fallback. |
| Node count is small or zero | Check the displayed source. ARP is an estimate; SNMP needs device support, read-only access, and the correct management device/VLAN view. |
| HTTP check fails while browser access works | The app's HTTP check is direct and does not currently use the browser's corporate proxy settings. |
| Audio is missing | Test the selected file, verify it is MP3/WAV and within limits, check Windows output volume, and confirm the mapping was saved. |

## Security and Change-Control Notes

- Use only approved targets and read-only SNMP credentials.
- SNMPv2c community strings are not encrypted in transit; they are also stored unencrypted in the local monitor configuration file. Treat that file and workstation as sensitive.
- Do not place passwords or community strings in screenshots, presentations, sample configurations, or support tickets.
- The dashboard defaults to local loopback operation. Do not expose the API to a network without a security review.
- Keep a record of the intended gateway, target, interface index, owner, and reason for each monitor so future administrators can maintain it.
- This application is an operational visibility aid. It does not configure network devices, guarantee route selection, or provide a certified SLA measurement.

## Quick Checklist

- [ ] Name and type identify the service clearly.
- [ ] Gateway is the intended next hop and target is an approved responding endpoint.
- [ ] Interval, timeout, failure count, and recovery count reflect operational needs.
- [ ] Optional TCP/HTTP checks match the intended service test.
- [ ] Throughput source (SNMP or local adapter) is understood.
- [ ] SNMP community is read-only, protected, and not shared in screenshots.
- [ ] Device count is understood as SNMP/ARP-observed, not guaranteed inventory.
- [ ] Down, recovery, and optional reminder audio have been tested.
- [ ] Monitor is enabled, saved, and its resulting status is verified.
