// BEL Cyber Network Operations Status — primary operations dashboard surface.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowDown, ArrowUp, AudioLines, Check, ChevronRight, CircleHelp, Clock3, Download, Gauge, LockKeyhole, LogOut, Maximize, Network, Plus, Radio, Router, Settings2, ShieldCheck, Signal, Wifi, WifiOff, X } from 'lucide-react';
import { api, websocketUrl } from './api';
import { alertAudio } from './audioQueue';
import type { DashboardData, EventItem, MonitorConfig, MonitorView, Sample } from './types';

const emptyData: DashboardData = { monitors: [], events: [], server_time: '' };
const statusLabels: Record<string, string> = { online: 'OPERATIONAL', degraded: 'DEGRADED', down: 'OFFLINE', gateway_down: 'GATEWAY DOWN', upstream_down: 'UPSTREAM LOST', application_down: 'APP FAILURE', unknown: 'AWAITING PROBE', disabled: 'DISABLED' };

function stamp(value: string | null | undefined) { return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--'; }
function elapsed(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
function rate(value: number | null) { if (value === null) return 'N/A'; if (value < 1_000) return `${value.toFixed(0)} bps`; if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} Kbps`; return `${(value / 1_000_000).toFixed(1)} Mbps`; }
function latency(value: number | null) { return value === null ? '---' : `${value.toFixed(1)} ms`; }
function bytesUsedTotal(used: number | null | undefined, total: number | null | undefined) {
  if (used == null || total == null) return 'N/A';
  const gib = 1024 ** 3;
  return `${(used / gib).toFixed(1)} / ${(total / gib).toFixed(1)} GB`;
}
function metricTone(value: number | null, warning: number, inverse = false) {
  if (value === null) return 'metric-wait';
  if (inverse ? value >= warning * 2 : value >= warning * 2) return 'metric-bad';
  return value > warning ? 'metric-warn' : 'metric-good';
}
function uptimeTone(value: number | null) {
  if (value === null) return 'metric-wait';
  if (value <= 35) return 'metric-bad';
  if (value <= 65) return 'metric-warn';
  return 'metric-good';
}
function lossTone(value: number | null) {
  if (value === null) return 'metric-wait';
  if (value <= 35) return 'metric-good';
  if (value <= 65) return 'metric-warn';
  return 'metric-bad';
}
function istDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function endpointState(value: boolean | number | null): 'signal-up' | 'signal-down' | 'signal-wait' {
  if (value === null) return 'signal-wait';
  return value === false || value === 0 ? 'signal-down' : 'signal-up';
}
function endpointLabel(value: boolean | number | null) {
  if (value === null) return 'NO SAMPLE';
  return value === false || value === 0 ? 'NO RESPONSE' : 'REACHABLE';
}

function createMonitor(): MonitorConfig {
  return { id: crypto.randomUUID().replaceAll('-', '').slice(0, 12), name: 'NEW MONITOR', type: 'internet', custom_type: null, enabled: true, gateway_ip: '', target: '', interval_seconds: 5, timeout_ms: 1200, failure_threshold: 3, recovery_threshold: 2, latency_warning_ms: 150, packet_loss_warning_pct: 5, source_ip: null, throughput_enabled: true, tcp_port: null, http_url: null, snmp: { enabled: false, host: null, port: 161, community: null, interface_index: null, counter_bits: 64 }, audio_down: null, audio_recovered: null, audio_reminder: null, alert_repeat_minutes: 30 };
}

export default function Dashboard() {
  const [data, setData] = useState(emptyData);
  const [backend, setBackend] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [adminToken, setAdminToken] = useState(sessionStorage.getItem('cybernoc-admin') || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [audioFiles, setAudioFiles] = useState<string[]>([]);
  const [editing, setEditing] = useState<MonitorConfig | null>(null);
  const [clock, setClock] = useState(new Date());
  const [notice, setNotice] = useState('');
  const [audioAlert, setAudioAlert] = useState<{ kind: 'down' | 'recovered' | 'down-reminder'; monitorName: string } | null>(null);
  const [exportDates, setExportDates] = useState({ start: istDate(), end: istDate() });
  const [sim, setSim] = useState(false);
  const [simulationCycle, setSimulationCycle] = useState(0);
  const [cardsPerRow, setCardsPerRow] = useState(() => {
    const saved = Number(window.localStorage.getItem('bel-cybernoc-columns'));
    return [2, 3, 4].includes(saved) ? saved : 2;
  });
  const seenEvents = useRef(new Set<number>());
  const wsRef = useRef<WebSocket | null>(null);
  const monitorsRef = useRef(data.monitors);
  monitorsRef.current = data.monitors;

  useEffect(() => alertAudio.subscribe((playback) => {
    if (playback.phase === 'started') {
      const monitorName = monitorsRef.current.find((entry) => entry.config.id === playback.monitorId)?.config.name || playback.monitorId;
      setAudioAlert({ kind: playback.kind as 'down' | 'recovered' | 'down-reminder', monitorName });
    } else {
      setAudioAlert(null);
    }
  }), []);

  useEffect(() => {
    const expireAdminSession = () => {
      sessionStorage.removeItem('cybernoc-admin');
      setAdminToken('');
      setEditing(null);
      setLoginError('Your admin session expired. Please sign in again.');
    };
    window.addEventListener('bel-cybernoc-auth-expired', expireAdminSession);
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    const poll = async () => {
      try { const snapshot = await api<DashboardData>('/api/dashboard'); setData(snapshot); setBackend(true); }
      catch { setBackend(false); }
    };
    void poll();
    const poller = window.setInterval(poll, 6000);
    let socket: WebSocket;
    let reconnect: number;
    const connect = () => {
      socket = new WebSocket(websocketUrl());
      wsRef.current = socket;
      socket.onopen = () => setBackend(true);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot') setData(message.data);
        if (message.type === 'event') {
          const item = message.event as EventItem;
          setData((current) => ({ ...current, events: [
            item,
            ...current.events.filter((entry) => entry.id !== item.id).map((entry) =>
              item.kind === 'recovered' && entry.monitor_id === item.monitor_id && entry.kind === 'down' && !entry.resolved_at
                ? { ...entry, resolved_at: item.occurred_at }
                : entry,
            ),
          ].slice(0, 20) }));
          if (!seenEvents.current.has(item.id)) {
            seenEvents.current.add(item.id);
            const monitor = monitorsRef.current.find((entry) => entry.config.id === item.monitor_id)?.config;
            const filename = item.kind === 'down' ? monitor?.audio_down : monitor?.audio_recovered;
            if (filename) alertAudio.enqueue({ monitorId: item.monitor_id, filename, kind: item.kind, eventId: `event-${item.id}` });
          }
        }
        if (message.type === 'alert_reminder') {
          const reminder = message.event as EventItem;
          const monitor = monitorsRef.current.find((entry) => entry.config.id === reminder.monitor_id)?.config;
          if (monitor?.audio_reminder) {
            alertAudio.enqueue({
              monitorId: reminder.monitor_id,
              filename: monitor.audio_reminder,
              kind: 'down-reminder',
              eventId: `down-reminder-${reminder.id}`,
            });
          }
        }
      };
      socket.onclose = () => { setBackend(false); reconnect = window.setTimeout(connect, 1800); };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => { window.removeEventListener('bel-cybernoc-auth-expired', expireAdminSession); window.clearInterval(timer); window.clearInterval(poller); window.clearTimeout(reconnect); socket?.close(); };
  }, []);

  useEffect(() => { if (adminToken) void api<{ files: string[] }>('/api/audio/files').then((result) => setAudioFiles(result.files)).catch(() => setAudioFiles([])); }, [adminToken]);

  useEffect(() => {
    if (drawer && adminToken) void api('/api/admin/session', {}, adminToken).catch(() => undefined);
  }, [drawer, adminToken]);

  const activeCount = data.monitors.filter((item) => item.config.enabled).length;
  const problemMonitors = data.monitors.filter((item) => item.config.enabled && ['down', 'gateway_down', 'upstream_down', 'application_down'].includes(item.status));
  const currentProblem = problemMonitors[0];
  const incidentEvents = useMemo(() => data.events
    .filter((event) => event.kind === 'down')
    .sort((first, second) => new Date(second.occurred_at).getTime() - new Date(first.occurred_at).getTime())
    .slice(0, 5), [data.events]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setLoginError('');
    try { const result = await api<{ token: string }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: loginPassword }) }); setAdminToken(result.token); sessionStorage.setItem('cybernoc-admin', result.token); setLoginPassword(''); }
    catch (error) { setLoginError(error instanceof Error ? error.message : 'Sign in failed'); }
  }

  async function signOut() {
    try { await api('/api/admin/logout', { method: 'POST' }, adminToken); } catch { /* Clear the local session even if the server session already expired. */ }
    sessionStorage.removeItem('cybernoc-admin');
    setAdminToken('');
    setEditing(null);
    setLoginError('');
  }

  async function exportIncidents() {
    if (!adminToken) { setDrawer(true); setNotice('SIGN IN TO EXPORT INCIDENT LOGS'); return; }
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/admin/incidents/export?start=${exportDates.start}&end=${exportDates.end}`, { headers: { Authorization: `Bearer ${adminToken}` } });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || 'Export failed');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `cybernoc-incidents-${exportDates.start}-to-${exportDates.end}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { setNotice(error instanceof Error ? error.message.toUpperCase() : 'EXPORT FAILED'); }
  }

  async function saveMonitor(event: React.FormEvent) {
    event.preventDefault(); if (!editing || !adminToken) return;
    try {
      const configs = data.monitors.map((item) => item.config);
      const currentIndex = configs.findIndex((item) => item.id === editing.id);
      if (currentIndex === -1) configs.push(editing);
      else configs[currentIndex] = editing;
      await api('/api/admin/monitors', { method: 'PUT', body: JSON.stringify({ monitors: configs }) }, adminToken);
      setEditing(null); setNotice('CONFIGURATION SAVED'); window.setTimeout(() => setNotice(''), 2500);
      const snapshot = await api<DashboardData>('/api/dashboard'); setData(snapshot);
    } catch (error) { setNotice(error instanceof Error ? error.message.toUpperCase() : 'SAVE FAILED'); }
  }

  async function moveMonitor(monitorId: string, direction: -1 | 1) {
    if (!adminToken) return;
    const configs = data.monitors.map((item) => item.config);
    const currentIndex = configs.findIndex((item) => item.id === monitorId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= configs.length) return;
    [configs[currentIndex], configs[nextIndex]] = [configs[nextIndex], configs[currentIndex]];
    try {
      await api('/api/admin/monitors', { method: 'PUT', body: JSON.stringify({ monitors: configs }) }, adminToken);
      setData(await api<DashboardData>('/api/dashboard'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : 'ORDER UPDATE FAILED');
    }
  }

  async function removeMonitor(id: string) {
    if (!adminToken || !window.confirm('Remove this monitor and stop its probe?')) return;
    const configs = data.monitors.map((item) => item.config).filter((item) => item.id !== id);
    await api('/api/admin/monitors', { method: 'PUT', body: JSON.stringify({ monitors: configs }) }, adminToken);
    setEditing(null); setData(await api<DashboardData>('/api/dashboard'));
  }

  function toggleSimulation() {
    if (!sim) {
      const monitor = data.monitors.find((item) => item.config.enabled);
      if (monitor?.config.audio_down) alertAudio.enqueue({ monitorId: monitor.config.id, filename: monitor.config.audio_down, kind: 'down', eventId: `simulation-${simulationCycle}-down` });
      setSim(true);
      return;
    }
    const monitor = data.monitors.find((item) => item.config.enabled);
    if (monitor?.config.audio_recovered) alertAudio.enqueue({ monitorId: monitor.config.id, filename: monitor.config.audio_recovered, kind: 'recovered', eventId: `simulation-${simulationCycle}-recovered` });
    setSim(false);
    setSimulationCycle((cycle) => cycle + 1);
  }

  function chooseCardsPerRow(value: number) {
    setCardsPerRow(value);
    window.localStorage.setItem('bel-cybernoc-columns', String(value));
  }

  return <main className="screen" onPointerDown={() => alertAudio.unlock()}>
    <div className="scene-grid" aria-hidden="true" /><div className="scene-scan" aria-hidden="true" />
    {audioAlert && <div className={`audio-alert-overlay ${audioAlert.kind === 'recovered' ? 'restored' : 'warning'}`} role="status" aria-live="assertive">
      <span className="audio-alert-kicker">{audioAlert.kind === 'recovered' ? '/// SYSTEM STATUS UPDATE' : '/// CRITICAL NETWORK ALERT'}</span>
      <strong>{audioAlert.kind === 'recovered' ? 'SERVER RESTORED' : 'WARNING // SERVER DOWN'}</strong>
      <span className="audio-alert-target">{audioAlert.monitorName}</span>
      <span className="audio-alert-signal">{audioAlert.kind === 'recovered' ? 'LINK STABLE · TELEMETRY RESUMED' : 'LINK FAILURE · INVESTIGATION REQUIRED'}</span>
    </div>}
    <header className="topbar">
      <div className="brand"><img className="brand-logo" src="/bel.ico" alt="BEL" /><div><div className="brand-name">BEL <span>IS&MS Network Operations Status</span></div><div className="brand-sub">BHARAT ELECTRONICS LIMITED <i>///</i> KOTDWARA</div></div><Network className="brand-end-icon" size={21} strokeWidth={1.8} aria-hidden="true" /></div>
      <div className="top-center"><span className={`live-pip ${backend ? 'is-live' : ''}`} />{backend ? 'TELEMETRY LINK ACTIVE' : 'BACKEND DISCONNECTED'}<b>·</b><span>LOCAL / LOOPBACK</span></div>
      <div className="top-actions"><div className="clock"><strong>{clock.toLocaleTimeString([], { hour12: false })}</strong><span>{clock.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</span></div><button className="icon-button" title="Enter full screen" onClick={() => document.documentElement.requestFullscreen?.()}><Maximize size={18} /></button><button className="icon-button" title="Monitor configuration" onClick={() => setDrawer(true)}><Settings2 size={19} /></button></div>
    </header>

    {(sim || currentProblem) && <div className={`alert-ribbon ${sim ? 'simulated' : ''}`}><AlertTriangle size={19} /><strong>{sim ? 'SIMULATED INCIDENT' : 'NETWORK INCIDENT'}</strong><span>{sim ? 'PREVIEW ONLY — SIMULATED LINE FAILURE' : currentProblem ? `${currentProblem.config.name} — ${statusLabels[currentProblem.status] || currentProblem.status.toUpperCase()}${problemMonitors.length > 1 ? ` (+${problemMonitors.length - 1})` : ''}` : ''}</span><span className="ribbon-time">{sim ? 'NOT LIVE' : currentProblem?.last_check ? stamp(currentProblem.last_check) : 'INVESTIGATING'}</span></div>}

    <section className="summary-strip">
      <Metric icon={<Radio />} label="MONITORS ACTIVE" value={`${activeCount.toString().padStart(2, '0')} / ${data.monitors.length.toString().padStart(2, '0')}`} tone="cyan" /><Metric icon={<Activity />} label="NETWORK STATE" value={problemMonitors.length ? 'ATTENTION' : backend ? 'NOMINAL' : 'NO LINK'} tone={problemMonitors.length ? 'red' : backend ? 'green' : 'amber'} /><Metric icon={<ShieldCheck />} label="LIVE INCIDENTS" value={String(problemMonitors.length).padStart(2, '0')} tone={problemMonitors.length ? 'red' : 'green'} /><Metric icon={<Gauge />} label="PROBE ENGINE" value={backend ? 'RUNNING' : 'OFFLINE'} tone={backend ? 'green' : 'red'} /><div className="summary-right local-time-display"><span className="micro-label">LOCAL SYSTEM TIME <i>IST</i></span><strong>{clock.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</strong></div>
    </section>

    {sim && <div className="simulation-banner"><CircleHelp size={15} /> SIMULATION PREVIEW ACTIVE — not live telemetry. Clear this preview to return to measured data.<button onClick={() => setSim(false)}>EXIT PREVIEW <X size={13} /></button></div>}

    <section className="section-heading"><div><span className="section-index">01</span><h1>LINE STATUS</h1><span className="section-caption">LIVE REACHABILITY <i>·</i> ROUTE-AWARE PROBES</span></div><div className="section-tools"><span className="refresh-mark"><span /> PROBE WINDOW 20 S</span></div></section>

    {data.monitors.length === 0 ? <div className="empty-state"><Router size={29} /><strong>NO MONITORS CONFIGURED</strong><span>Open monitor configuration to add your first network line.</span><button onClick={() => setDrawer(true)}>OPEN CONFIGURATION <ChevronRight size={14} /></button></div> : <section className="monitor-grid" data-columns={cardsPerRow}>{data.monitors.map((monitor, index) => <MonitorCard key={monitor.config.id} monitor={monitor} index={index} simulated={sim} onEdit={() => { setEditing(monitor.config); setDrawer(true); }} />)}</section>}

    <section className="lower-grid"><div className="panel events-panel"><PanelTitle index="02" title="INCIDENT TIMELINE" right={<span className="micro-live"><span /> LAST OUTAGES</span>} />{incidentEvents.length ? <div className="event-list">{incidentEvents.map((event) => {
      const currentDown = data.monitors.some((item) => item.config.id === event.monitor_id && item.config.enabled && ['down', 'gateway_down', 'upstream_down', 'application_down'].includes(item.status));
      const start = event.occurred_at;
      const end = event.resolved_at;
      const ongoing = !end && currentDown;
      const duration = end || ongoing
        ? elapsed(new Date(ongoing ? clock : end!).getTime() - new Date(start).getTime())
        : 'DURATION UNKNOWN';
      const isRecovered = Boolean(end);
      const isHistorical = !ongoing && !isRecovered;
      const stateLabel = isRecovered ? 'RESTORED' : ongoing ? 'STILL DOWN' : 'HISTORICAL';
      const timeRange = `DOWN ${stamp(start)}  ·  ${duration}  ·  ${isRecovered ? `RECOVERED ${stamp(end)}` : ongoing ? 'STILL DOWN' : 'RECOVERY UNKNOWN'}`;
      return <div className="event-row" key={event.id}><div className={`event-mark ${isRecovered ? 'recovered' : isHistorical ? 'historical' : 'down'}`} /><strong>{event.monitor_name}</strong><span className={isRecovered ? 'event-up' : isHistorical ? 'event-historical' : 'event-down'}>{stateLabel}</span><span className="event-detail" title={timeRange}>{timeRange}</span></div>;
    })}</div> : <div className="no-events"><Check size={15} /> NO RECENT INCIDENTS <span>Events appear after verified state transitions.</span></div>}</div>
      <div className="panel integrity-panel"><PanelTitle index="03" title="NODE INTEGRITY" /><div className="integrity-content"><div className="integrity-status"><div className={`integrity-ring ${backend ? 'ok' : 'bad'}`}><ShieldCheck size={23} /></div><div><strong>{backend ? 'LOCAL ENGINE READY' : 'API UNAVAILABLE'}</strong><span>{backend ? 'FASTAPI · SQLITE · WEBSOCKET' : 'WAITING FOR LOCAL BACKEND'}</span></div></div><div className="host-resources"><ResourceMeter label="CPU" value={data.system?.cpu_percent == null ? 'N/A' : `${data.system.cpu_percent.toFixed(0)}%`} percent={data.system?.cpu_percent ?? null} /><ResourceMeter label="RAM" value={bytesUsedTotal(data.system?.ram_used_bytes, data.system?.ram_total_bytes)} percent={data.system?.ram_percent ?? null} /><ResourceMeter label="STORAGE" value={bytesUsedTotal(data.system?.storage_used_bytes, data.system?.storage_total_bytes)} percent={data.system?.storage_percent ?? null} /></div></div></div>
    </section>
    <footer className="footer"></footer>

    {drawer && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDrawer(false); setEditing(null); } }}>
      <aside className="drawer">
        <div className="drawer-head">
          <div><span className="section-index">SYS / CONFIG</span><h2>MONITOR CONTROL</h2></div>
          <div className="drawer-head-actions">
            {adminToken && <button className="icon-button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>}
            <button className="icon-button" onClick={() => { setDrawer(false); setEditing(null); }} aria-label="Close"><X size={19} /></button>
          </div>
        </div>
        <div className="display-settings">
          <div className="form-section-title">WALL DISPLAY</div>
          <div className="display-setting-row">
            <span>MONITORS PER ROW</span>
            <div className="display-segmented" role="group" aria-label="Monitors per row">
              {[2, 3, 4].map((count) => <button key={count} type="button" className={cardsPerRow === count ? 'selected' : ''} aria-pressed={cardsPerRow === count} onClick={() => chooseCardsPerRow(count)}>{count}</button>)}
            </div>
          </div>
          <button type="button" className={`simulation-toggle drawer-simulation ${sim ? 'selected' : ''}`} onClick={() => { toggleSimulation(); setDrawer(false); }}><Activity size={14} /> {sim ? 'END SIMULATION' : 'SIMULATION PREVIEW'}</button>
          <div className="export-settings"><div className="form-section-title">INCIDENT LOG EXPORT <span className="optional">IST · 12-HOUR FORMAT</span></div><div className="export-dates"><label>FROM<input type="date" value={exportDates.start} onChange={(event) => setExportDates((current) => ({ ...current, start: event.target.value }))} /></label><label>TO<input type="date" value={exportDates.end} onChange={(event) => setExportDates((current) => ({ ...current, end: event.target.value }))} /></label></div><button type="button" className="add-monitor export-button" onClick={() => void exportIncidents()}><Download size={14} /> EXPORT EXCEL CSV</button></div>
        </div>
        {!adminToken ? <form className="login-box" onSubmit={signIn}>
          <LockKeyhole size={22} /><h3>ADMIN AUTHENTICATION</h3>
          <p>Configuration changes require the local admin password from the backend data folder.</p>
          <label>ADMIN PASSWORD<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></label>
          {loginError && <div className="form-error">{loginError}</div>}
          <button className="save-button">UNLOCK CONFIGURATION <ChevronRight size={15} /></button>
        </form> : <>
          <div className="drawer-toolbar">
            <span>{data.monitors.length} CONFIGURED LINES</span>
            <button onClick={() => setEditing(createMonitor())}><Plus size={14} /> NEW MONITOR</button>
          </div>
          <div className="monitor-list">
            {data.monitors.map((item, index) => <div className={`monitor-list-row ${editing?.id === item.config.id ? 'active' : ''}`} key={item.config.id}>
              <button className="monitor-list-select" onClick={() => setEditing(item.config)}>
                <span className="monitor-position">{String(index + 1).padStart(2, '0')}</span>
                <span className="monitor-list-name"><i className={`mini-dot ${item.status}`} />{item.config.name}</span>
                <span className="monitor-list-type">{item.config.type.replace('_', ' ').toUpperCase()}</span>
              </button>
              <div className="monitor-order-controls">
                <button type="button" title={`Move ${item.config.name} up`} aria-label={`Move ${item.config.name} up`} disabled={index === 0} onClick={() => void moveMonitor(item.config.id, -1)}><ArrowUp size={14} /></button>
                <button type="button" title={`Move ${item.config.name} down`} aria-label={`Move ${item.config.name} down`} disabled={index === data.monitors.length - 1} onClick={() => void moveMonitor(item.config.id, 1)}><ArrowDown size={14} /></button>
              </div>
            </div>)}
          </div>
          {editing && <MonitorForm key={editing.id} value={editing} files={audioFiles} onChange={setEditing} onSubmit={saveMonitor} onRemove={() => void removeMonitor(editing.id)} isNew={!data.monitors.some((item) => item.config.id === editing.id)} onTestAudio={(filename) => void alertAudio.test(filename, adminToken).catch((error) => setNotice(error.message.toUpperCase()))} />}
        </>}
      </aside>
    </div>}
    {notice && <div className="toast-message">{notice}</div>}
  </main>;
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) { return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong className={tone}>{value}</strong></div></div>; }
function PanelTitle({ index, title, right }: { index: string; title: string; right?: React.ReactNode }) { return <div className="panel-title"><div><span>{index}</span><h2>{title}</h2></div>{right}</div>; }
function ResourceMeter({ label, value, percent }: { label: string; value: string; percent: number | null }) {
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return <div className="host-resource">
    <div className="host-resource-label"><span>{label}</span><strong>{value}</strong></div>
    <div className="resource-track"><span style={{ width: `${width}%` }} /></div>
  </div>;
}

function MonitorCard({ monitor, index, simulated, onEdit }: { monitor: MonitorView; index: number; simulated: boolean; onEdit: () => void }) {
  const { config } = monitor;
  const previewStatus = simulated && index === 0 ? 'down' : simulated && index === 1 ? 'degraded' : monitor.status;
  const stateClass = simulated && index < 2 ? previewStatus : !config.enabled ? 'disabled' : previewStatus;
  const lineDown = ['down', 'gateway_down', 'upstream_down', 'application_down'].includes(stateClass);
  const displayUptime = monitor.uptime_pct_24h;
  const displayLoss = displayUptime === null ? null : 100 - displayUptime;
  const history = monitor.history.slice(-32);
  return <article className={`monitor-card state-${stateClass}`}>
    <div className="card-accent" />    <div className="card-head"><div className="card-name"><span className="line-number">LN-{String(index + 1).padStart(2, '0')}</span><div><h2>{config.name}</h2><span className="card-type">{(config.custom_type || config.type.replace('_', ' ')).toUpperCase()}</span></div></div><div className={`state-badge ${stateClass}`}><span />{statusLabels[stateClass] || stateClass.toUpperCase()}</div><button className="card-settings" onClick={onEdit} title="Edit monitor"><Settings2 size={16} /></button></div>
    <div className="endpoint-row"><div><span>GATEWAY <Signal className={`network-icon ${endpointState(monitor.gateway_reachable)}`} size={13} /></span><strong>{config.gateway_ip || 'NOT CONFIGURED'}</strong><small className={endpointState(monitor.gateway_reachable) === 'signal-down' ? 'bad-text' : ''}>{endpointLabel(monitor.gateway_reachable)}</small></div><div className="endpoint-link"><span /></div><div><span>REMOTE TARGET <Signal className={`network-icon ${endpointState(monitor.target_reachable)}`} size={13} /></span><strong>{config.target || 'NOT CONFIGURED'}</strong><small className={endpointState(monitor.target_reachable) === 'signal-down' ? 'bad-text' : ''}>{endpointLabel(monitor.target_reachable)}</small></div></div>
    <div className="card-metrics"><div className={metricTone(monitor.latency_ms, config.latency_warning_ms)}><span><Signal size={13} /> RTT</span><strong>{simulated && index === 0 ? '---' : latency(monitor.latency_ms)}</strong></div><div className={lossTone(displayLoss)}><span>{lineDown ? <WifiOff className="line-down-icon" size={13} /> : <Wifi size={13} />} LOSS</span><strong>{simulated && index === 0 ? '---' : displayLoss === null ? '---' : `${displayLoss.toFixed(1)}%`}</strong></div><div className={uptimeTone(displayUptime)}><span><Clock3 size={13} /> DAILY UPTIME</span><strong>{displayUptime === null ? '---' : `${displayUptime.toFixed(1)}%`}</strong></div></div>
    <div className="history-chart"><div className="chart-title"><span>LATENCY / HISTORY</span><span>{monitor.last_check ? stamp(monitor.last_check) : 'AWAITING DATA'}</span></div><MiniChart samples={history} status={previewStatus} /></div>
    <div className="throughput"><div><span><i className="rx-arrow">↓</i> RX / IN</span><strong>{rate(monitor.rx_bps)}</strong></div><div><span><i className="tx-arrow">↑</i> TX / OUT</span><strong>{rate(monitor.tx_bps)}</strong></div><div className="route-note"><Router size={13} /><span>{monitor.route_strategy === 'source-address' ? `SRC ${config.source_ip}` : 'WINDOWS DEFAULT ROUTE'}</span></div></div>
    {simulated && index < 2 && <div className="sim-card-tag">SIMULATED PREVIEW</div>}
  </article>;
}

function MiniChart({ samples, status }: { samples: Sample[]; status: string }) {
  const valid = samples.filter((item) => item.latency_ms !== null).map((item) => item.latency_ms as number);
  if (!valid.length) return <div className="chart-empty"><span />NO HISTORICAL MEASUREMENTS</div>;
  const max = Math.max(20, ...valid) * 1.15;
  const points = valid.map((value, index) => `${index / Math.max(1, valid.length - 1) * 100},${28 - value / max * 24}`).join(' ');
  return <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`chart-svg ${status}`} aria-label="Historical latency chart"><line x1="0" x2="100" y1="26" y2="26" className="chart-axis" /><polyline points={`0,28 ${points} 100,28`} className="chart-area" /><polyline points={points} className="chart-line" /></svg>;
}

function MonitorForm({ value, files, onChange, onSubmit, onRemove, isNew, onTestAudio }: { value: MonitorConfig; files: string[]; onChange: (value: MonitorConfig) => void; onSubmit: (event: React.FormEvent) => void; onRemove: () => void; isNew: boolean; onTestAudio: (file: string) => void }) {
  const update = <K extends keyof MonitorConfig>(key: K, next: MonitorConfig[K]) => onChange({ ...value, [key]: next });
  const updateSnmp = (key: keyof MonitorConfig['snmp'], next: MonitorConfig['snmp'][keyof MonitorConfig['snmp']]) => onChange({ ...value, snmp: { ...value.snmp, [key]: next } });
  return <form className="monitor-form" onSubmit={onSubmit}><div className="form-section-title">LINE PARAMETERS</div><label>DISPLAY NAME<input value={value.name} onChange={(event) => update('name', event.target.value)} required maxLength={80} /></label><div className="form-two"><label>MONITOR TYPE<select value={value.type} onChange={(event) => update('type', event.target.value as MonitorConfig['type'])}><option value="sap_intranet">SAP / INTRANET</option><option value="internet">INTERNET LINE</option><option value="server">SERVER</option><option value="other">OTHER</option></select></label><label className="toggle-row">ENABLED<input type="checkbox" checked={value.enabled} onChange={(event) => update('enabled', event.target.checked)} /><span /></label></div>{value.type === 'other' && <label>CUSTOM LINE TYPE<input value={value.custom_type || ''} placeholder="VPN / MPLS / CCTV" onChange={(event) => update('custom_type', event.target.value || null)} required maxLength={40} /></label>}<label>GATEWAY IP<input value={value.gateway_ip} placeholder="192.0.2.1" onChange={(event) => update('gateway_ip', event.target.value)} required /></label><label>REMOTE TARGET<input value={value.target} placeholder="198.51.100.10 or service.example" onChange={(event) => update('target', event.target.value)} required /></label><div className="form-two"><label>INTERVAL (SEC)<input type="number" min="2" max="300" value={value.interval_seconds} onChange={(event) => update('interval_seconds', Number(event.target.value))} /></label><label>TIMEOUT (MS)<input type="number" min="100" max="15000" value={value.timeout_ms} onChange={(event) => update('timeout_ms', Number(event.target.value))} /></label></div><label>SOURCE INTERFACE IP <span className="optional">OPTIONAL</span><input value={value.source_ip || ''} placeholder="Windows NIC IPv4 address" onChange={(event) => update('source_ip', event.target.value || null)} /></label><div className="form-two"><label>DOWN AFTER N FAILURES<input type="number" min="1" max="20" value={value.failure_threshold} onChange={(event) => update('failure_threshold', Number(event.target.value))} /></label><label>RECOVER AFTER N OK<input type="number" min="1" max="20" value={value.recovery_threshold} onChange={(event) => update('recovery_threshold', Number(event.target.value))} /></label></div><div className="form-two"><label>TCP PORT <span className="optional">OPTIONAL</span><input type="number" min="1" max="65535" value={value.tcp_port || ''} onChange={(event) => update('tcp_port', event.target.value ? Number(event.target.value) : null)} /></label><label>HTTP(S) URL <span className="optional">OPTIONAL</span><input value={value.http_url || ''} placeholder="https://service.local/health" onChange={(event) => update('http_url', event.target.value || null)} /></label></div>
    <div className="form-section-title">THROUGHPUT COLLECTION</div><label className="toggle-row">RX / TX SPEED<input type="checkbox" checked={value.throughput_enabled} onChange={(event) => update('throughput_enabled', event.target.checked)} /><span /></label><div className="form-hint">Uses SNMP first, then local Windows adapter fallback.</div><div className="form-section-title">SNMP INTERFACE COUNTERS</div><label className="toggle-row">SNMP COUNTERS<input type="checkbox" checked={value.snmp.enabled} onChange={(event) => updateSnmp('enabled', event.target.checked)} /><span /></label>{value.snmp.enabled && <><label>SNMP HOST<input value={value.snmp.host || ''} onChange={(event) => updateSnmp('host', event.target.value || null)} required /></label><div className="form-two"><label>READ-ONLY COMMUNITY<input type="password" value={value.snmp.community || ''} onChange={(event) => updateSnmp('community', event.target.value || null)} required /></label><label>IF INDEX<input type="number" min="1" value={value.snmp.interface_index || ''} onChange={(event) => updateSnmp('interface_index', event.target.value ? Number(event.target.value) : null)} required /></label></div><label>COUNTER WIDTH<select value={value.snmp.counter_bits} onChange={(event) => updateSnmp('counter_bits', Number(event.target.value) as 32 | 64)}><option value="64">64-BIT (IF-MIB HIGH CAPACITY)</option><option value="32">32-BIT (IF-MIB)</option></select></label></>}
    <div className="form-section-title">VOICE ALERT MAPPING <span className="optional">AUDIO FOLDER: C:\CyberNOC\audio</span></div><AudioSelect label="DOWN ALERT" value={value.audio_down} files={files} onChange={(next) => update('audio_down', next)} onTest={onTestAudio} /><AudioSelect label="RECOVERY ALERT" value={value.audio_recovered} files={files} onChange={(next) => update('audio_recovered', next)} onTest={onTestAudio} /><AudioSelect label="REPEAT ALERT AUDIO" value={value.audio_reminder} files={files} onChange={(next) => update('audio_reminder', next)} onTest={onTestAudio} /><label>REPEAT EVERY (MINUTES)<span className="optional">DEFAULT 30 · RANGE 1–1440</span><input type="number" min="1" max="1440" step="1" value={value.alert_repeat_minutes} onChange={(event) => update('alert_repeat_minutes', Number(event.target.value))} required /></label>
    <button className="save-button"><Check size={15} /> {isNew ? 'ADD MONITOR' : 'SAVE CHANGES'}</button>{!isNew && <button type="button" className="remove-button" onClick={onRemove}>REMOVE MONITOR</button>}</form>;
}

function AudioSelect({ label, value, files, onChange, onTest }: { label: string; value: string | null; files: string[]; onChange: (value: string | null) => void; onTest: (file: string) => void }) { return <div className="audio-select"><label>{label}<select value={value || ''} onChange={(event) => onChange(event.target.value || null)}><option value="">NO AUDIO</option>{files.map((file) => <option value={file} key={file}>{file}</option>)}</select></label><button type="button" title="Test audio playback" disabled={!value} onClick={() => value && onTest(value)}><AudioLines size={14} /></button></div>; }