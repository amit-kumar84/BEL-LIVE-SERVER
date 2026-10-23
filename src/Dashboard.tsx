// BEL Cyber Network Operations Status — primary operations dashboard surface.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowDown, ArrowUp, AudioLines, Check, ChevronRight, CircleHelp, Clock3, Download, Gauge, LockKeyhole, LogOut, Maximize, Minimize, Monitor, Moon, Network, Plus, Radio, Router, Settings2, ShieldCheck, Signal, Sun, Upload, Wifi, WifiOff, X } from 'lucide-react';
import { api, websocketUrl } from './api';
import { alertAudio } from './audioQueue';
import type { DashboardData, EventItem, MonitorConfig, MonitorView, Sample } from './types';

declare global {
  interface Window {
    belCyberNoc?: {
      isFullscreen: () => Promise<boolean>;
      toggleFullscreen: () => Promise<boolean>;
      focusWindow: () => Promise<boolean> | boolean;
      raiseAlertAudio: () => Promise<boolean> | boolean;
      onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
    };
  }
}

const emptyData: DashboardData = { monitors: [], events: [], server_time: '' };
type DisplayTheme = 'cybertech' | 'classic' | 'modern';
type ModernColorMode = 'light' | 'dark';
const statusLabels: Record<string, string> = { online: 'OPERATIONAL', degraded: 'DEGRADED', down: 'OFFLINE', gateway_down: 'GATEWAY DOWN', upstream_down: 'UPSTREAM LOST', application_down: 'APP FAILURE', unknown: 'AWAITING PROBE', disabled: 'DISABLED' };
const bootSequence = [
  'BEL CORE INITIALIZATION',
  'SECURE KERNEL HANDSHAKE',
  'NEURAL TELEMETRY LINK ESTABLISHED',
  'NETWORK TOPOLOGY SYNCHRONIZED',
  'PROBE ENGINE CALIBRATION COMPLETE',
  'THREAT MONITORING GRID ONLINE',
  'ALL CORE SYSTEMS OPERATIONAL',
  'WELCOME, ADMINISTRATOR',
];
const bootAudioFiles = ['/START-ENGLISH-Futuristic-Alert.mp3', '/START-HINDI-Futuristic-Alert.mp3'];
const maxAlertAudioDurationSeconds = 60;

function stamp(value: string | null | undefined) { return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--'; }
function incidentDate(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)).toUpperCase() : '-- --- ----'; }
function incidentStamp(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(value)) : '--:--:--'; }
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
function latency(value: number | null) { return value === null ? '---' : value < 1 ? '<1 ms' : `${value.toFixed(1)} ms`; }
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
function maskEndpoint(value: string, masked: boolean) {
  if (!masked || !value) return value;
  const parts = value.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) return `${parts[0]}.${parts[1]}.***.***`;
  if (value.length <= 4) return '***';
  return `${value.slice(0, 3)}***`;
}

async function prepareAppAudio() {
  try {
    await window.belCyberNoc?.raiseAlertAudio?.();
  } catch (error) {
    console.error('Unable to raise Windows master volume before audio playback.', error);
  }
}

async function audioDuration(file: File) {
  const source = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error('AUDIO MUST BE A VALID MP3 OR WAV FILE'));
      audio.src = source;
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

function createMonitor(): MonitorConfig {
  return { id: crypto.randomUUID().replaceAll('-', '').slice(0, 12), name: 'NEW MONITOR', type: 'internet', custom_type: null, enabled: true, gateway_ip: '', target: '', interval_seconds: 5, timeout_ms: 1200, failure_threshold: 3, recovery_threshold: 2, latency_warning_ms: 150, packet_loss_warning_pct: 5, source_ip: null, throughput_enabled: true, active_nodes_visible: true, tcp_port: null, http_url: null, snmp: { enabled: false, host: null, port: 161, community: null, interface_index: null, counter_bits: 64, client_discovery_enabled: false }, audio_down: 'down-default-alert.mp3', audio_recovered: 'restored-default-alert.mp3', audio_reminder: null, alert_repeat_minutes: 30 };
}

export default function Dashboard() {
  const [data, setData] = useState(emptyData);
  const [backend, setBackend] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'monitors' | 'about'>('monitors');
  const [removeConfirmation, setRemoveConfirmation] = useState<{ id: string; name: string } | null>(null);
  const [adminToken, setAdminToken] = useState(sessionStorage.getItem('cybernoc-admin') || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [failedLoginAttempts, setFailedLoginAttempts] = useState(0);
  const [loginLockedUntil, setLoginLockedUntil] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [securityWarning, setSecurityWarning] = useState(false);
  const [accessOverlay, setAccessOverlay] = useState<{
    mode: 'granted' | 'denied';
    stage: 'verified' | 'granted' | 'welcome' | 'wrong-password' | 'denied';
    progress: number;
  } | null>(null);
  const [audioFiles, setAudioFiles] = useState<string[]>([]);
  const [editing, setEditing] = useState<MonitorConfig | null>(null);
  const [clock, setClock] = useState(new Date());
  const [notice, setNotice] = useState('');
  const [audioAlert, setAudioAlert] = useState<{ kind: 'down' | 'recovered' | 'down-reminder'; monitorName: string; monitorType: string; source: 'audio' | 'silent' } | null>(null);
  const [showBootSequence, setShowBootSequence] = useState(true);
  const [bootStep, setBootStep] = useState(0);
  const [bootProgress, setBootProgress] = useState(0);
  const [bootAudioSource] = useState(() => bootAudioFiles[Math.floor(Math.random() * bootAudioFiles.length)]);
  const [backendOfflineAlertShown, setBackendOfflineAlertShown] = useState(false);
  const [exportDates, setExportDates] = useState({ start: istDate(), end: istDate() });
  const [sim, setSim] = useState(false);
  const [simulationCycle, setSimulationCycle] = useState(0);
  const [displayTheme, setDisplayTheme] = useState<DisplayTheme>(() => {
    const saved = window.localStorage.getItem('bel-cybernoc-theme');
    return saved === 'classic' || saved === 'modern' ? saved : 'cybertech';
  });
  const [modernColorMode, setModernColorMode] = useState<ModernColorMode>(() => window.localStorage.getItem('bel-cybernoc-modern-mode') === 'dark' ? 'dark' : 'light');
  const [cardsPerRow, setCardsPerRow] = useState(() => {
    const saved = Number(window.localStorage.getItem('bel-cybernoc-columns'));
    return [2, 3, 4].includes(saved) ? saved : 2;
  });
  const [maskedNetworkLines, setMaskedNetworkLines] = useState<Record<string, boolean>>(() => {
    try {
      const saved = window.localStorage.getItem('bel-cybernoc-mask-network-lines');
      return saved ? JSON.parse(saved) as Record<string, boolean> : {};
    } catch {
      return {};
    }
  });
  const seenEvents = useRef(new Set<number>());
  const silentAlertTimerRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bootAudioRef = useRef<HTMLAudioElement | null>(null);
  const applyDashboardData = (next: DashboardData) => {
    setData(next);
    monitorsRef.current = next.monitors;
  };
  const backendOfflineAudioRef = useRef<HTMLAudioElement | null>(null);
  const accessGrantedAudioRef = useRef<HTMLAudioElement | null>(null);
  const accessDeniedAudioRef = useRef<HTMLAudioElement | null>(null);
  const securityWarningAudioRef = useRef<HTMLAudioElement | null>(null);
  const monitorsRef = useRef(data.monitors);
  monitorsRef.current = data.monitors;
  const showSilentAlert = (monitorId: string, kind: 'down' | 'recovered' | 'down-reminder') => {
    const monitor = monitorsRef.current.find((entry) => entry.config.id === monitorId)?.config;
    if (silentAlertTimerRef.current !== null) window.clearTimeout(silentAlertTimerRef.current);
    setAudioAlert({
      kind,
      monitorName: monitor?.name || monitorId,
      monitorType: monitor ? (monitor.custom_type || monitor.type.replace('_', ' ')).toUpperCase() : 'NETWORK DEVICE',
      source: 'silent',
    });
    silentAlertTimerRef.current = window.setTimeout(() => {
      setAudioAlert((current) => current?.source === 'silent' ? null : current);
      silentAlertTimerRef.current = null;
    }, 5000);
  };

  useEffect(() => {
    const updateFullscreen = (fullscreen: boolean) => setFullScreen(fullscreen);
    if (window.belCyberNoc) {
      void window.belCyberNoc.isFullscreen().then(updateFullscreen);
      return window.belCyberNoc.onFullscreenChange(updateFullscreen);
    }
    const handleFullscreenChange = () => updateFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (loginLockedUntil === 0) {
      setCooldownSeconds(0);
      return;
    }
    const updateCooldown = () => {
      const remaining = Math.max(0, Math.ceil((loginLockedUntil - Date.now()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining <= 0) setLoginLockedUntil(0);
    };
    updateCooldown();
    const timer = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(timer);
  }, [loginLockedUntil]);

  useEffect(() => {
    if (!showBootSequence) return;
    setBootStep(0);
    setBootProgress(0);
    const audio = bootAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    const updateProgress = () => {
      if (!audio.duration || !Number.isFinite(audio.duration)) return;
      const progress = Math.min(1, audio.currentTime / audio.duration);
      setBootProgress(progress);
      setBootStep(Math.min(bootSequence.length - 1, Math.floor(progress * bootSequence.length)));
    };
    const finishBoot = () => {
      setBootProgress(1);
      setBootStep(bootSequence.length - 1);
      audio.pause();
      setShowBootSequence(false);
    };
    const startAudio = () => void prepareAppAudio().then(() => audio.play()).catch((error: unknown) => {
      if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') console.error('Unable to play boot audio.', error);
    });
    const handleMetadata = () => {
      window.setTimeout(() => {
        if (!audio.ended) startAudio();
      }, 0);
    };
    audio.addEventListener('loadedmetadata', handleMetadata);
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', finishBoot);
    if (audio.readyState >= 1) handleMetadata();
    return () => {
      audio.removeEventListener('loadedmetadata', handleMetadata);
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('ended', finishBoot);
      audio.pause();
    };
  }, [showBootSequence]);

  useEffect(() => alertAudio.setPlaybackPreparation(prepareAppAudio), []);

  useEffect(() => {
    if (window.belCyberNoc) alertAudio.unlock();
  }, []);

  useEffect(() => {
    const unsubscribe = alertAudio.subscribe((playback) => {
      if (playback.phase === 'started') {
        if (silentAlertTimerRef.current !== null) window.clearTimeout(silentAlertTimerRef.current);
        silentAlertTimerRef.current = null;
        const monitor = monitorsRef.current.find((entry) => entry.config.id === playback.monitorId)?.config;
        const monitorName = monitor?.name || playback.monitorId;
        const monitorType = monitor ? (monitor.custom_type || monitor.type.replace('_', ' ')).toUpperCase() : 'NETWORK DEVICE';
        setAudioAlert({ kind: playback.kind as 'down' | 'recovered' | 'down-reminder', monitorName, monitorType, source: 'audio' });
        window.belCyberNoc?.focusWindow?.();
      } else {
        setAudioAlert((current) => current?.source === 'audio' ? null : current);
      }
    });
    return () => {
      unsubscribe();
      if (silentAlertTimerRef.current !== null) window.clearTimeout(silentAlertTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!audioAlert) return;
    window.belCyberNoc?.focusWindow?.();
  }, [audioAlert]);

  useEffect(() => {
    if (backend) {
      setBackendOfflineAlertShown(false);
      backendOfflineAudioRef.current?.pause();
      return;
    }
    if (showBootSequence || backendOfflineAlertShown) return;
    setBackendOfflineAlertShown(true);
    const audio = backendOfflineAudioRef.current;
    if (audio) {
      audio.currentTime = 0;
      void prepareAppAudio().then(() => audio.play()).catch((error: unknown) => {
        if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') console.error('Unable to play backend offline audio.', error);
      });
    }
  }, [backend, showBootSequence, backendOfflineAlertShown]);

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
      try { const snapshot = await api<DashboardData>('/api/dashboard'); applyDashboardData(snapshot); setBackend(true); }
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
        if (message.type === 'snapshot') applyDashboardData(message.data);
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
            if (item.kind === 'down' || item.kind === 'recovered') {
              const filename = item.kind === 'down' ? monitor?.audio_down : monitor?.audio_recovered;
              if (filename) alertAudio.enqueue({ monitorId: item.monitor_id, filename, kind: item.kind, eventId: `event-${item.id}` });
              else showSilentAlert(item.monitor_id, item.kind);
            }
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
          } else showSilentAlert(reminder.monitor_id, 'down-reminder');
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
  const minimumColumns = data.monitors.length <= 3 ? data.monitors.length : Math.ceil(data.monitors.length / 2);
  const monitorColumns = Math.min(4, data.monitors.length, Math.max(cardsPerRow, minimumColumns));
  const problemMonitors = data.monitors.filter((item) => item.config.enabled && ['down', 'gateway_down', 'upstream_down', 'application_down'].includes(item.status));
  const currentProblem = problemMonitors[0];
  const incidentEvents = useMemo(() => data.events
    .filter((event) => event.kind === 'down')
    .sort((first, second) => new Date(second.occurred_at).getTime() - new Date(first.occurred_at).getTime())
    .slice(0, 4), [data.events]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    const isLocked = loginLockedUntil > Date.now();
    if (isLocked) {
      const remaining = Math.max(1, Math.ceil((loginLockedUntil - Date.now()) / 1000));
      setLoginError(`ACCESS LOCKED — RETRY IN ${remaining}s`);
      return;
    }
    setLoginError('');
    try {
      const result = await api<{ token: string }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: loginPassword }) });
      setLoginPassword('');
      setLoginError('');
      setFailedLoginAttempts(0);
      setLoginLockedUntil(0);
      setSecurityWarning(false);
      setAccessOverlay({ mode: 'granted', stage: 'verified', progress: 0 });
      await playSecurityAudio(accessGrantedAudioRef, (progress) => {
        setAccessOverlay({
          mode: 'granted',
          stage: progress >= 0.55 ? 'welcome' : progress >= 0.2 ? 'granted' : 'verified',
          progress,
        });
      });
      setAdminToken(result.token);
      sessionStorage.setItem('cybernoc-admin', result.token);
      setDrawer(true);
      setAccessOverlay(null);
    } catch (error) {
      const nextAttempts = failedLoginAttempts + 1;
      setFailedLoginAttempts(nextAttempts);
      setLoginPassword('');
      if (nextAttempts >= 3) {
        const lockUntil = Date.now() + 30_000;
        setLoginLockedUntil(lockUntil);
        setSecurityWarning(true);
        setLoginError('ACCESS DENIED — AUTH LOCKED FOR 30 SECONDS');
        void playSecurityAudio(securityWarningAudioRef);
      } else {
        setLoginError('ACCESS DENIED — INCORRECT ADMIN PASSWORD');
        setAccessOverlay({ mode: 'denied', stage: 'wrong-password', progress: 0 });
        await playSecurityAudio(accessDeniedAudioRef, (progress) => {
          setAccessOverlay({ mode: 'denied', stage: progress >= 0.55 ? 'denied' : 'wrong-password', progress });
        });
        setAccessOverlay(null);
      }
    }
  }

  function playSecurityAudio(audioRef: { current: HTMLAudioElement | null }, onProgress?: (progress: number) => void) {
    return new Promise<void>((resolve) => {
      const audio = audioRef.current;
      if (!audio) {
        resolve();
        return;
      }
      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
        resolve();
      };
      audio.currentTime = 0;
      audio.onended = () => {
        onProgress?.(1);
        cleanup();
      };
      audio.onerror = cleanup;
      audio.ontimeupdate = () => {
        if (!audio.duration || !Number.isFinite(audio.duration)) return;
        onProgress?.(Math.min(1, audio.currentTime / audio.duration));
      };
      void prepareAppAudio().then(() => audio.play()).catch((error: unknown) => {
        if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') console.error('Unable to play security audio.', error);
        cleanup();
      });
    });
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
      if (currentIndex === -1 && configs.length >= 8) {
        setNotice('MAXIMUM OF 8 MONITORS ALLOWED');
        return;
      }
      if (currentIndex === -1) configs.push(editing);
      else configs[currentIndex] = editing;
      await api('/api/admin/monitors', { method: 'PUT', body: JSON.stringify({ monitors: configs }) }, adminToken);
      setEditing(null); setNotice('CONFIGURATION SAVED'); window.setTimeout(() => setNotice(''), 2500);
      const snapshot = await api<DashboardData>('/api/dashboard'); applyDashboardData(snapshot);
    } catch (error) { setNotice(error instanceof Error ? error.message.toUpperCase() : 'SAVE FAILED'); }
  }

  async function uploadAudioFile(file: File) {
    if (!adminToken) throw new Error('SIGN IN TO UPLOAD AUDIO');
    try {
      const duration = await audioDuration(file);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('AUDIO DURATION COULD NOT BE READ');
      if (duration > maxAlertAudioDurationSeconds) throw new Error('AUDIO MUST NOT EXCEED 60 SECONDS');
      const result = await api<{ file: string }>(`/api/admin/audio/${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      }, adminToken);
      setAudioFiles((current) => [...new Set([...current, result.file])].sort());
      setNotice(`AUDIO SAVED: ${result.file.toUpperCase()}`);
      window.setTimeout(() => setNotice(''), 2500);
      return result.file;
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : 'AUDIO UPLOAD FAILED');
      throw error;
    }
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
      applyDashboardData(await api<DashboardData>('/api/dashboard'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : 'ORDER UPDATE FAILED');
    }
  }

  function removeMonitor(id: string, name: string) {
    if (!adminToken) return;
    setRemoveConfirmation({ id, name });
  }

  async function confirmRemoveMonitor() {
    if (!adminToken || !removeConfirmation) return;
    const { id } = removeConfirmation;
    const configs = data.monitors.map((item) => item.config).filter((item) => item.id !== id);
    try {
      await api('/api/admin/monitors', { method: 'PUT', body: JSON.stringify({ monitors: configs }) }, adminToken);
      setEditing(null);
      setRemoveConfirmation(null);
      applyDashboardData(await api<DashboardData>('/api/dashboard'));
      setNotice('MONITOR REMOVED');
    } catch (error) {
      setRemoveConfirmation(null);
      setNotice(error instanceof Error ? error.message.toUpperCase() : 'MONITOR REMOVAL FAILED');
    }
  }

  function toggleSimulation() {
    if (!sim) {
      const monitor = data.monitors.find((item) => item.config.enabled);
      if (monitor?.config.audio_down) alertAudio.enqueue({ monitorId: monitor.config.id, filename: monitor.config.audio_down, kind: 'down', eventId: `simulation-${simulationCycle}-down` });
      else if (monitor) showSilentAlert(monitor.config.id, 'down');
      setSim(true);
      return;
    }
    const monitor = data.monitors.find((item) => item.config.enabled);
    if (monitor?.config.audio_recovered) alertAudio.enqueue({ monitorId: monitor.config.id, filename: monitor.config.audio_recovered, kind: 'recovered', eventId: `simulation-${simulationCycle}-recovered` });
    else if (monitor) showSilentAlert(monitor.config.id, 'recovered');
    setSim(false);
    setSimulationCycle((cycle) => cycle + 1);
  }

  function setNetworkIpMask(monitorId: string, masked: boolean) {
    setMaskedNetworkLines((current) => {
      const next = { ...current, [monitorId]: masked };
      window.localStorage.setItem('bel-cybernoc-mask-network-lines', JSON.stringify(next));
      return next;
    });
  }

  function chooseCardsPerRow(value: number) {
    setCardsPerRow(value);
    window.localStorage.setItem('bel-cybernoc-columns', String(value));
  }

  function chooseDisplayTheme(value: DisplayTheme) {
    setDisplayTheme(value);
    window.localStorage.setItem('bel-cybernoc-theme', value);
  }

  function toggleModernColorMode() {
    const next = modernColorMode === 'light' ? 'dark' : 'light';
    setModernColorMode(next);
    window.localStorage.setItem('bel-cybernoc-modern-mode', next);
  }

  return <main className={`screen theme-${displayTheme} ${displayTheme === 'modern' ? `modern-${modernColorMode}` : ''}`} onPointerDown={() => { alertAudio.unlock(); void bootAudioRef.current?.play().catch(() => undefined); void backendOfflineAudioRef.current?.play().catch(() => undefined); }}>
    <div className="scene-grid" aria-hidden="true" /><div className="scene-scan" aria-hidden="true" />
    {showBootSequence && <div className="boot-sequence" role="status" aria-live="polite">
      <audio ref={bootAudioRef} src={bootAudioSource} preload="auto" />
      <div className="boot-stars" aria-hidden="true" />
      <div className="boot-data-stream boot-data-stream-left" aria-hidden="true">NODE_01 // AUTH OK<br />GATEWAY // SECURE<br />PACKET FLOW // ACTIVE<br />ENCRYPTION // AES-256</div>
      <div className="boot-data-stream boot-data-stream-right" aria-hidden="true">BEL-NOC / 127.0.0.1<br />TELEMETRY // ONLINE<br />UPLINK // VERIFIED<br />THREAT GRID // READY</div>
      <div className="boot-radar" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="boot-core">
        <div className="boot-logo-frame"><span /><img src="/Bharat_Electronics_logo.png" alt="Bharat Electronics Limited" /><span /></div>
        <div className="boot-kicker">BHARAT ELECTRONICS // SECURE NOC</div>
        <div className="boot-title">IS&amp;MS <span>NETWORK OPERATIONS</span></div>
        <div className="boot-orbit" aria-hidden="true"><i /><i /><i /></div>
        <div className="boot-status">{bootSequence[bootStep]}</div>
        <div className="boot-detail">AUTHENTICATING NETWORK OPERATIONS ENVIRONMENT</div>
        <div className="boot-progress"><span style={{ width: `${Math.round(bootProgress * 100)}%` }} /></div>
        <div className="boot-counter">SYSTEM STARTUP <b>{String(Math.round(bootProgress * 100)).padStart(3, '0')}%</b></div>
      </div>
    </div>}
    {!backend && !showBootSequence && <div className="backend-offline-overlay" role="alert" aria-live="assertive">
      <audio ref={backendOfflineAudioRef} src="/BACKEND-OFFLINE.mp3" preload="auto" />
      <div className="backend-offline-grid" aria-hidden="true" />
      <div className="backend-offline-core">
        <div className="backend-offline-icon"><WifiOff size={72} /></div>
        <span className="backend-offline-kicker">/// CRITICAL INFRASTRUCTURE ALERT ///</span>
        <strong>BACKEND OFFLINE</strong>
        <span className="backend-offline-message">LOCAL TELEMETRY ENGINE IS NOT RESPONDING</span>
        <div className="backend-offline-status"><i /> ATTEMPTING SECURE RECONNECTION <b>·</b> AUTO RETRY ACTIVE</div>
        <div className="backend-offline-loader"><span /></div>
        <span className="backend-offline-hint">CHECK FASTAPI SERVICE / PORT 8000 / LOCAL NETWORK</span>
      </div>
    </div>}
    {audioAlert && <div className={`audio-alert-overlay ${audioAlert.kind === 'recovered' ? 'restored' : audioAlert.kind === 'down-reminder' ? 'reminder' : 'warning'}`} role="status" aria-live="assertive">
      <span className="audio-alert-kicker">{audioAlert.kind === 'recovered' ? '/// SYSTEM STATUS UPDATE' : audioAlert.kind === 'down-reminder' ? '/// REPEATING INCIDENT ALERT' : '/// CRITICAL NETWORK ALERT'}</span>
      <strong>{audioAlert.kind === 'recovered' ? `${audioAlert.monitorType} RESTORED` : audioAlert.kind === 'down-reminder' ? `WARNING // ${audioAlert.monitorType} STILL DOWN` : `WARNING // ${audioAlert.monitorType} DOWN`}</strong>
      <span className="audio-alert-target">{audioAlert.monitorName}</span>
      <span className="audio-alert-signal">{audioAlert.kind === 'recovered' ? 'LINK STABLE · TELEMETRY RESUMED' : audioAlert.kind === 'down-reminder' ? 'INCIDENT REMAINS ACTIVE · INVESTIGATION REQUIRED' : 'LINK FAILURE · INVESTIGATION REQUIRED'}</span>
    </div>}
    <audio ref={accessGrantedAudioRef} src="/Access-Granted-Futuristic-Alert.mp3" preload="auto" />
    <audio ref={accessDeniedAudioRef} src="/Access-Denied-Futuristic-Alert.mp3" preload="auto" />
    <audio ref={securityWarningAudioRef} src="/SECURITY-WARNING-Futuristic-Alert.mp3" preload="auto" />
    {accessOverlay && <div className={`access-granted-overlay ${accessOverlay.mode === 'denied' ? 'denied' : ''}`} role={accessOverlay.mode === 'denied' ? 'alert' : 'status'} aria-live={accessOverlay.mode === 'denied' ? 'assertive' : 'polite'}>
      <div className="access-granted-glow" />
      <div className="access-granted-core">
        <div className="access-granted-ring"><LockKeyhole size={68} /></div>
        <span className="access-granted-kicker">{accessOverlay.mode === 'denied' ? accessOverlay.stage === 'wrong-password' ? '/// CREDENTIALS REJECTED ///' : '/// AUTHORIZATION DENIED ///' : accessOverlay.stage === 'verified' ? '/// CREDENTIALS VERIFIED ///' : accessOverlay.stage === 'granted' ? '/// AUTHORIZATION CONFIRMED ///' : '/// SECURE SESSION INITIALIZED ///'}</span>
        <strong key={accessOverlay.stage} className="access-granted-title">{accessOverlay.stage === 'wrong-password' ? 'WRONG PASSWORD' : accessOverlay.stage === 'denied' ? 'ACCESS DENIED' : accessOverlay.stage === 'verified' ? 'PASSWORD VERIFIED' : accessOverlay.stage === 'granted' ? 'ACCESS GRANTED' : 'WELCOME ADMINISTRATOR'}</strong>
        <span className="access-granted-message">{accessOverlay.mode === 'denied' ? accessOverlay.stage === 'wrong-password' ? 'PASSWORD COULD NOT BE VERIFIED' : 'CHECK YOUR CREDENTIALS AND TRY AGAIN' : accessOverlay.stage === 'verified' ? 'SECURE SESSION CHECK IN PROGRESS' : accessOverlay.stage === 'granted' ? 'INITIALIZING ADMINISTRATOR ACCESS' : 'CONFIGURATION MATRIX UNLOCKED'}</span>
        <div className="access-granted-progress" role="progressbar" aria-label={accessOverlay.mode === 'denied' ? 'Access denied audio' : 'Access confirmation audio'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(accessOverlay.progress * 100)}>
          <span style={{ transform: `scaleX(${accessOverlay.progress})` }} />
        </div>
      </div>
    </div>}
    {securityWarning && <div className="security-warning-overlay" role="alert" aria-live="assertive">
      <div className="security-warning-grid" aria-hidden="true" />
      <div className="security-warning-core">
        <div className="security-warning-symbol"><LockKeyhole size={68} /></div>
        <span className="security-warning-kicker">/// SECURITY PROTOCOL TRIGGERED ///</span>
        <strong>ACCESS BLOCKED</strong>
        <span className="security-warning-message">MULTIPLE INVALID ADMIN AUTHENTICATION ATTEMPTS</span>
        <div className="security-warning-status"><i /> SECURITY WARNING <b>·</b> COOLDOWN ACTIVE: {cooldownSeconds}s</div>
        <span className="security-warning-hint">VERIFY CREDENTIALS BEFORE RETRYING</span>
        <button type="button" className="security-warning-dismiss" onClick={() => setSecurityWarning(false)}>ACKNOWLEDGE WARNING <ChevronRight size={15} /></button>
      </div>
    </div>}
    <header className="topbar">
      <div className="brand"><img className="brand-logo" src="/bel.ico" alt="BEL" /><div><div className="brand-name">BEL <span>IS&MS Network Operations Status</span></div><div className="brand-sub">BHARAT ELECTRONICS LIMITED <i>///</i> KOTDWARA</div></div><Network className="brand-end-icon" size={21} strokeWidth={1.8} aria-hidden="true" /></div>
      <div className="top-center"><span className={`live-pip ${backend ? 'is-live' : ''}`} />{backend ? 'TELEMETRY LINK ACTIVE' : 'BACKEND DISCONNECTED'}<b>·</b><span>LOCAL / LOOPBACK</span></div>
      <div className="top-actions"><div className="clock"><strong>{clock.toLocaleTimeString([], { hour12: false })}</strong><span>{clock.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</span></div>{displayTheme === 'modern' && <button className="icon-button color-mode-button is-modern-mode" title={`Switch to ${modernColorMode === 'light' ? 'dark' : 'light'} mode`} aria-label={`Switch to ${modernColorMode === 'light' ? 'dark' : 'light'} mode`} onClick={toggleModernColorMode}>{modernColorMode === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>}<button className="icon-button" title={fullScreen ? 'Exit full screen' : 'Enter full screen'} aria-label={fullScreen ? 'Exit full screen' : 'Enter full screen'} onClick={() => { if (window.belCyberNoc) void window.belCyberNoc.toggleFullscreen(); else if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }}>{fullScreen ? <Minimize size={18} /> : <Maximize size={18} />}</button><button className="icon-button" title="Monitor configuration" onClick={() => setDrawer(true)}><Settings2 size={19} /></button></div>
    </header>

    {(sim || currentProblem) && <div className={`alert-ribbon ${sim ? 'simulated' : ''}`}><AlertTriangle size={19} /><strong>{sim ? 'SIMULATED INCIDENT' : 'NETWORK INCIDENT'}</strong><span>{sim ? 'PREVIEW ONLY — SIMULATED LINE FAILURE' : currentProblem ? `${currentProblem.config.name} — ${statusLabels[currentProblem.status] || currentProblem.status.toUpperCase()}${problemMonitors.length > 1 ? ` (+${problemMonitors.length - 1})` : ''}` : ''}</span><span className="ribbon-time">{sim ? 'NOT LIVE' : currentProblem?.last_check ? stamp(currentProblem.last_check) : 'INVESTIGATING'}</span></div>}

    <section className="summary-strip">
      <Metric icon={<Radio />} label="SERVER ACTIVE" value={`${activeCount.toString().padStart(2, '0')} / ${data.monitors.length.toString().padStart(2, '0')}`} tone="cyan" /><Metric icon={<Activity />} label="NETWORK STATE" value={problemMonitors.length ? 'ATTENTION' : backend ? 'NOMINAL' : 'NO LINK'} tone={problemMonitors.length ? 'red' : backend ? 'green' : 'amber'} /><Metric icon={<ShieldCheck />} label="LIVE INCIDENTS" value={String(problemMonitors.length).padStart(2, '0')} tone={problemMonitors.length ? 'red' : 'green'} /><Metric icon={<Gauge />} label="PROBE ENGINE" value={backend ? 'RUNNING' : 'OFFLINE'} tone={backend ? 'green' : 'red'} /><div className="summary-right local-time-display"><span className="micro-label">LOCAL SYSTEM TIME <i>IST</i></span><strong>{clock.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</strong></div>
      </section>

    {sim && <div className="simulation-banner"><CircleHelp size={15} /> SIMULATION PREVIEW ACTIVE — not live telemetry. Clear this preview to return to measured data.<button onClick={() => setSim(false)}>EXIT PREVIEW <X size={13} /></button></div>}

    <section className="section-heading"><div><span className="section-index">01</span><h1>LINE STATUS</h1><span className="section-caption">LIVE REACHABILITY <i>·</i> ROUTE-AWARE PROBES</span></div><div className="section-tools"><span className="refresh-mark"><span /> PROBE WINDOW 20 S</span></div></section>

    {data.monitors.length === 0 ? <div className="empty-state"><Router size={29} /><strong>NO MONITORS CONFIGURED</strong><span>Open monitor configuration to add your first network line.</span><button onClick={() => setDrawer(true)}>OPEN CONFIGURATION <ChevronRight size={14} /></button></div> : <section className="monitor-grid" data-columns={monitorColumns}>{data.monitors.map((monitor, index) => <MonitorCard key={monitor.config.id} monitor={monitor} index={index} simulated={sim} maskNetworkIps={maskedNetworkLines[monitor.config.id] === true} onEdit={() => { setEditing(monitor.config); setDrawer(true); }} />)}</section>}

    <section className="lower-grid"><div className="panel events-panel"><PanelTitle index="02" title="INCIDENT TIMELINE" right={<span className="micro-live"><span /> LAST OUTAGES</span>} />{incidentEvents.length ? <div className="event-list"><div className="event-header"><span /> <span>MONITOR / LINE</span><span>STATE</span><span>DATE</span><span>DOWN TIME</span><span>UP TIME</span><span>DURATION</span></div>{incidentEvents.map((event) => {
      const currentDown = data.monitors.some((item) => item.config.id === event.monitor_id && item.config.enabled && ['down', 'gateway_down', 'upstream_down', 'application_down'].includes(item.status));
      const start = event.occurred_at;
      const end = event.resolved_at;
      const ongoing = !end && currentDown;
      const durationMs = end || ongoing ? new Date(ongoing ? clock : end!).getTime() - new Date(start).getTime() : null;
      const duration = end || ongoing
        ? elapsed(durationMs!)
        : 'DURATION UNKNOWN';
      const isRecovered = Boolean(end);
      const isHistorical = !ongoing && !isRecovered;
      const stateLabel = isRecovered ? 'RESTORED' : ongoing ? 'STILL DOWN' : 'HISTORICAL';
      const durationTone = durationMs === null ? 'event-historical' : durationMs < 15 * 60 * 1000 ? 'event-duration-short' : 'event-duration-long';
      const timeRange = `DOWN ${incidentStamp(start)} · ${isRecovered ? `UP ${incidentStamp(end)}` : ongoing ? 'STILL DOWN' : 'UP UNKNOWN'} · ${duration}`;
      return <div className={`event-row ${isRecovered ? 'is-recovered' : ongoing ? 'is-ongoing' : 'is-historical'}`} key={event.id}><div className={`event-mark ${isRecovered ? 'recovered' : isHistorical ? 'historical' : 'down'}`} /><strong>{event.monitor_name}</strong><span className={isRecovered ? 'event-up' : isHistorical ? 'event-historical' : 'event-down'}>{stateLabel}</span><span className="event-date">{incidentDate(start)}</span><span className="event-down" title={`Down time: ${incidentStamp(start)}`}>{incidentStamp(start)}</span><span className={isRecovered ? 'event-up' : 'event-historical'} title={isRecovered ? `Up time: ${incidentStamp(end)}` : 'Up time unavailable'}>{isRecovered ? incidentStamp(end) : ongoing ? '--:--:--' : 'UNKNOWN'}</span><span className={`event-duration ${durationTone}`} title={timeRange}>{duration}</span></div>;
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
        <div className="drawer-tabs" role="tablist" aria-label="Drawer navigation">
          <button type="button" className={drawerTab === 'monitors' ? 'selected' : ''} onClick={() => setDrawerTab('monitors')} role="tab" aria-selected={drawerTab === 'monitors'}>MONITORS</button>
          <button type="button" className={drawerTab === 'about' ? 'selected' : ''} onClick={() => setDrawerTab('about')} role="tab" aria-selected={drawerTab === 'about'}>ABOUT</button>
        </div>
        {drawerTab === 'about' ? <AboutCard /> : adminToken ? <>
          <div className="display-settings">
            <div className="form-section-title">WALL DISPLAY</div>
            <div className="display-setting-row">
              <span>MONITORS PER ROW</span>
              <div className="display-segmented" role="group" aria-label="Preferred monitors per row">
                {[2, 3, 4].map((count) => <button key={count} type="button" className={cardsPerRow === count ? 'selected' : ''} aria-pressed={cardsPerRow === count} onClick={() => chooseCardsPerRow(count)}>{count}</button>)}
              </div>
            </div>
            <div className="form-hint">MAX 8 LINES · COLUMNS ADJUST TO KEEP THE DISPLAY WITHIN 2 ROWS</div>
            <div className="display-setting-row">
              <span>VISUAL THEME</span>
              <div className="display-segmented theme-segmented" role="group" aria-label="Visual theme">
                <button type="button" className={displayTheme === 'cybertech' ? 'selected' : ''} aria-pressed={displayTheme === 'cybertech'} onClick={() => chooseDisplayTheme('cybertech')}>CYBERTECH</button>
                <button type="button" className={displayTheme === 'classic' ? 'selected' : ''} aria-pressed={displayTheme === 'classic'} onClick={() => chooseDisplayTheme('classic')}>CLASSIC</button>
                <button type="button" className={displayTheme === 'modern' ? 'selected' : ''} aria-pressed={displayTheme === 'modern'} onClick={() => chooseDisplayTheme('modern')}>MODERN</button>
              </div>
            </div>
            <button type="button" className={`simulation-toggle drawer-simulation ${sim ? 'selected' : ''}`} onClick={() => { toggleSimulation(); setDrawer(false); }}><Activity size={14} /> {sim ? 'END SIMULATION' : 'SIMULATION PREVIEW'}</button>
            <div className="export-settings"><div className="form-section-title">INCIDENT LOG EXPORT <span className="optional">IST · 12-HOUR FORMAT</span></div><div className="export-dates"><label>FROM<input type="date" value={exportDates.start} onChange={(event) => setExportDates((current) => ({ ...current, start: event.target.value }))} /></label><label>TO<input type="date" value={exportDates.end} onChange={(event) => setExportDates((current) => ({ ...current, end: event.target.value }))} /></label></div><button type="button" className="add-monitor export-button" onClick={() => void exportIncidents()}><Download size={14} /> EXPORT EXCEL CSV</button></div>
          </div>
          <div className="drawer-toolbar">
            <span>{data.monitors.length} / 8 CONFIGURED LINES</span>
            <button disabled={data.monitors.length >= 8} title={data.monitors.length >= 8 ? 'Maximum of 8 monitors reached' : 'Add monitor'} onClick={() => setEditing(createMonitor())}><Plus size={14} /> NEW MONITOR</button>
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
          {editing && <MonitorForm key={editing.id} value={editing} files={audioFiles} maskNetworkIps={maskedNetworkLines[editing.id] === true} onMaskNetworkIpsChange={(masked) => setNetworkIpMask(editing.id, masked)} onChange={setEditing} onSubmit={saveMonitor} onRemove={() => removeMonitor(editing.id, editing.name)} isNew={!data.monitors.some((item) => item.config.id === editing.id)} onTestAudio={(filename) => void alertAudio.test(filename, adminToken).catch((error) => setNotice(error.message.toUpperCase()))} onUploadAudio={uploadAudioFile} />}
        </> : <form className="login-box" onSubmit={signIn}>
          <LockKeyhole size={22} /><h3>ADMIN AUTHENTICATION</h3>
          <p>Configuration changes require the local admin password from the backend data folder.</p>
          <label>ADMIN PASSWORD<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required disabled={loginLockedUntil > Date.now()} /></label>
          {loginError && <div className="form-error">{loginError}</div>}
          <button className="save-button" disabled={loginLockedUntil > Date.now()}>{loginLockedUntil > Date.now() ? `LOCKED ${cooldownSeconds}s` : 'UNLOCK CONFIGURATION'} <ChevronRight size={15} /></button>
        </form>}
      </aside>
    </div>}
    {removeConfirmation && <div className="confirmation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRemoveConfirmation(null); }}>
      <div className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-monitor-title" aria-describedby="remove-monitor-message">
        <div className="confirmation-icon"><AlertTriangle size={25} /></div>
        <span className="confirmation-kicker">/// DESTRUCTIVE ACTION ///</span>
        <h2 id="remove-monitor-title">REMOVE MONITOR?</h2>
        <p id="remove-monitor-message">Remove <strong>{removeConfirmation.name}</strong> and stop its probe?</p>
        <div className="confirmation-actions">
          <button type="button" className="confirmation-cancel" onClick={() => setRemoveConfirmation(null)}>CANCEL</button>
          <button type="button" className="confirmation-remove" onClick={() => void confirmRemoveMonitor()}>REMOVE MONITOR <X size={14} /></button>
        </div>
      </div>
    </div>}
    {notice && <div className="toast-message">{notice}</div>}
  </main>;
}

function AboutCard() {
  return <div className="about-panel-shell">
    <div className="about-card">
      <div className="about-card-glow" />
      <div className="about-card-header">
        <div>
          <span className="section-index">SYS / ABOUT</span>
          <h3>BEL CYBERNOC</h3>
        </div>
        <div className="about-badge">v1.0.0</div>
      </div>
      <p className="about-kicker">WINDOWS NETWORK OPERATIONS PLATFORM</p>
      <div className="about-hero">
        <div className="about-logo"><ShieldCheck size={20} /></div>
        <div>
          <strong>Developed by Amit Kumar</strong>
          <span>Developed for Bharat Electronics Limited, Kotdwar, to give operators a clear, real-time view of configured network links and services.</span>
        </div>
      </div>
      <section className="about-details" aria-labelledby="about-capabilities-title">
        <h4 id="about-capabilities-title">PLATFORM CAPABILITIES</h4>
        <p>BEL CyberNOC checks configured gateways, remote targets, and application endpoints, then brings their availability and performance into one live operations dashboard.</p>
        <ul>
          <li><strong>Connectivity:</strong> independent gateway and target checks, with optional TCP-port and HTTP(S) health tests.</li>
          <li><strong>Performance:</strong> response time, packet loss, daily uptime, and historical measurements for each monitored line.</li>
          <li><strong>Traffic:</strong> RX/TX throughput from read-only SNMP counters or the selected Windows network adapter.</li>
          <li><strong>Operations:</strong> live down/recovery status, visual and audio alerts, configurable thresholds, and incident export by IST date range.</li>
        </ul>
        <p className="about-data-note">Monitoring history is stored locally. Checks should only be configured for systems and networks you are authorized to monitor.</p>
      </section>
      <div className="about-meta-grid">
        <div className="about-meta">
          <span>Developer</span>
          <strong>Amit Kumar </strong>
        </div>
        <div className="about-meta">
          <span>GitHub</span>
          <a href="https://github.com/amit-kumar84" target="_blank" rel="noreferrer">github.com/amit-kumar84</a>
        </div>
        <div className="about-meta">
          <span>Developed</span>
          <strong>2026</strong>
        </div>
        <div className="about-meta">
          <span>Built for</span>
          <strong>Bharat Electronics Limited, Kotdwar</strong>
        </div>
      </div>
      <div className="about-footer">
        <div><Radio size={14} /> Gateway & target monitoring</div>
        <div><Network size={14} /> Live incident & alert visibility</div>
      </div>
    </div>
  </div>;
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

function MonitorCard({ monitor, index, simulated, maskNetworkIps, onEdit }: { monitor: MonitorView; index: number; simulated: boolean; maskNetworkIps: boolean; onEdit: () => void }) {
  const { config } = monitor;
  const previewStatus = simulated && index === 0 ? 'down' : simulated && index === 1 ? 'degraded' : monitor.status;
  const stateClass = simulated && index < 2 ? previewStatus : !config.enabled ? 'disabled' : previewStatus;
  const lineDown = ['down', 'gateway_down', 'upstream_down', 'application_down'].includes(stateClass);
  const clientSourceLabel = monitor.connected_clients.source === 'snmp' ? 'SNMP-observed' : 'ARP-observed';
  const displayUptime = monitor.uptime_pct_24h;
  const displayLoss = monitor.packet_loss_pct;
  const history = monitor.history.slice(-32);
  return <article className={`monitor-card state-${stateClass}`}>
    <div className="card-accent" />    <div className="card-head"><div className="card-name"><span className="line-number">LN-{String(index + 1).padStart(2, '0')}</span><div className="card-title-group"><div className="card-title-row"><h2>{config.name}</h2>{config.active_nodes_visible && <div className={`card-client-count ${monitor.status}`} title={`${clientSourceLabel} active nodes: ${monitor.connected_clients.count ?? 'unavailable'}`} aria-label={`${clientSourceLabel} active nodes: ${monitor.connected_clients.count ?? 'unavailable'}`}><i className="active-node-pulse" /><Monitor size={15} /><strong>{monitor.connected_clients.count ?? '--'}</strong></div>}</div><span className="card-type">{(config.custom_type || config.type.replace('_', ' ')).toUpperCase()}</span></div></div><div className={`state-badge ${stateClass}`}><span />{statusLabels[stateClass] || stateClass.toUpperCase()}</div><button className="card-settings" onClick={onEdit} title="Edit monitor"><Settings2 size={16} /></button></div>
    <div className="endpoint-row"><div><span>GATEWAY <Signal className={`network-icon ${endpointState(monitor.gateway_reachable)}`} size={13} /></span><strong>{maskEndpoint(config.gateway_ip, maskNetworkIps) || 'NOT CONFIGURED'}</strong><small className={endpointState(monitor.gateway_reachable) === 'signal-down' ? 'bad-text' : ''}>{endpointLabel(monitor.gateway_reachable)}</small></div><div className="endpoint-link"><span /></div><div><span>REMOTE TARGET <Signal className={`network-icon ${endpointState(monitor.target_reachable)}`} size={13} /></span><strong>{maskEndpoint(config.target, maskNetworkIps) || 'NOT CONFIGURED'}</strong><small className={endpointState(monitor.target_reachable) === 'signal-down' ? 'bad-text' : ''}>{endpointLabel(monitor.target_reachable)}</small></div></div>
    <div className="card-metrics"><div className={metricTone(monitor.latency_ms, config.latency_warning_ms)}><span><Signal size={13} /> RTT</span><strong>{simulated && index === 0 ? '---' : latency(monitor.latency_ms)}</strong></div><div className={lossTone(displayLoss)}><span>{lineDown ? <WifiOff className="line-down-icon" size={13} /> : <Wifi size={13} />} LOSS</span><strong>{simulated && index === 0 ? '---' : displayLoss === null ? '---' : `${displayLoss.toFixed(1)}%`}</strong></div><div className={uptimeTone(displayUptime)}><span><Clock3 size={13} /> DAILY UPTIME</span><strong>{displayUptime === null ? '---' : `${displayUptime.toFixed(1)}%`}</strong></div></div>
    <div className="history-chart"><div className="chart-title"><span>RTT <i className="chart-key gateway" />GW <i className="chart-key target" />TARGET</span><span>{monitor.last_check ? stamp(monitor.last_check) : 'AWAITING DATA'}</span></div><MiniChart samples={history} status={previewStatus} /></div>
    <div className="throughput"><div><span><i className="rx-arrow">↓</i> RX / IN</span><strong>{rate(monitor.rx_bps)}</strong></div><div><span><i className="tx-arrow">↑</i> TX / OUT</span><strong>{rate(monitor.tx_bps)}</strong></div><div className="route-note"><Router size={13} /><span>{monitor.route_strategy === 'source-address' ? `SRC ${config.source_ip}` : 'WINDOWS DEFAULT ROUTE'}</span></div></div>
    {simulated && index < 2 && <div className="sim-card-tag">SIMULATED PREVIEW</div>}
  </article>;
}

function MiniChart({ samples, status }: { samples: Sample[]; status: string }) {
  const valid = samples.flatMap((item) => [item.gateway_latency_ms, item.latency_ms]).filter((value): value is number => value !== null);
  if (!valid.length) return <div className="chart-empty"><span />NO HISTORICAL MEASUREMENTS</div>;
  const minimum = Math.min(...valid);
  const maximum = Math.max(...valid);
  const padding = Math.max((maximum - minimum) * 0.2, maximum * 0.08, 0.1);
  const lowerBound = Math.max(0, minimum - padding);
  const upperBound = maximum + padding;
  const range = Math.max(upperBound - lowerBound, 0.2);
  const pathFor = (readLatency: (item: Sample) => number | null) => {
    const commands: string[] = [];
    let connected = false;
    samples.forEach((item, index) => {
      const value = readLatency(item);
      if (value === null) { connected = false; return; }
      const x = index / Math.max(1, samples.length - 1) * 100;
      const y = 25 - (value - lowerBound) / range * 22;
      commands.push(`${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`);
      connected = true;
    });
    return commands.join(' ');
  };
  const gatewayPath = pathFor((item) => item.gateway_latency_ms);
  const targetPath = pathFor((item) => item.latency_ms);
  return <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`chart-svg ${status}`} aria-label="Gateway and target RTT history"><line x1="0" x2="100" y1="26" y2="26" className="chart-axis" />{gatewayPath && <path d={gatewayPath} className="chart-gateway-line" />}{targetPath && <path d={targetPath} className="chart-target-line" />}</svg>;
}

function MonitorForm({ value, files, maskNetworkIps, onMaskNetworkIpsChange, onChange, onSubmit, onRemove, isNew, onTestAudio, onUploadAudio }: { value: MonitorConfig; files: string[]; maskNetworkIps: boolean; onMaskNetworkIpsChange: (masked: boolean) => void; onChange: (value: MonitorConfig) => void; onSubmit: (event: React.FormEvent) => void; onRemove: () => void; isNew: boolean; onTestAudio: (file: string) => void; onUploadAudio: (file: File) => Promise<string> }) {
  const update = <K extends keyof MonitorConfig>(key: K, next: MonitorConfig[K]) => onChange({ ...value, [key]: next });
  const updateSnmp = (key: keyof MonitorConfig['snmp'], next: MonitorConfig['snmp'][keyof MonitorConfig['snmp']]) => onChange({ ...value, snmp: { ...value.snmp, [key]: next } });
  return <form className="monitor-form" onSubmit={onSubmit}>
    <div className="form-section-title">LINE PARAMETERS</div>
    <label>DISPLAY NAME<input value={value.name} onChange={(event) => update('name', event.target.value)} required maxLength={80} /></label>
    <div className="form-two">
      <label>MONITOR TYPE<select value={value.type} onChange={(event) => update('type', event.target.value as MonitorConfig['type'])}><option value="sap_intranet">SAP / INTRANET</option><option value="internet">INTERNET LINE</option><option value="server">SERVER</option><option value="other">OTHER</option></select></label>
      <label className="toggle-row">ENABLED<input type="checkbox" checked={value.enabled} onChange={(event) => update('enabled', event.target.checked)} /><span /></label>
    </div>
    {value.type === 'other' && <label>CUSTOM LINE TYPE<input value={value.custom_type || ''} placeholder="VPN / MPLS / CCTV" onChange={(event) => update('custom_type', event.target.value || null)} required maxLength={40} /></label>}
    <label>GATEWAY IP<input value={value.gateway_ip} placeholder="192.0.2.1" onChange={(event) => update('gateway_ip', event.target.value)} required /></label>
    <label>REMOTE TARGET<input value={value.target} placeholder="198.51.100.10 or service.example" onChange={(event) => update('target', event.target.value)} required /></label>
    <label className="toggle-row">MASK GATEWAY / TARGET IP ON WALL DISPLAY<input type="checkbox" checked={maskNetworkIps} onChange={(event) => onMaskNetworkIpsChange(event.target.checked)} /><span /></label>
    <div className="form-two">
      <label>INTERVAL (SEC)<input type="number" min="2" max="300" value={value.interval_seconds} onChange={(event) => update('interval_seconds', Number(event.target.value))} /></label>
      <label>TIMEOUT (MS)<input type="number" min="100" max="15000" value={value.timeout_ms} onChange={(event) => update('timeout_ms', Number(event.target.value))} /></label>
    </div>
    <label>SOURCE INTERFACE IP <span className="optional">OPTIONAL</span><input value={value.source_ip || ''} placeholder="Windows NIC IPv4 address" onChange={(event) => update('source_ip', event.target.value || null)} /></label>
    <div className="form-two">
      <label>DOWN AFTER N FAILURES<input type="number" min="1" max="20" value={value.failure_threshold} onChange={(event) => update('failure_threshold', Number(event.target.value))} /></label>
      <label>RECOVER AFTER N OK<input type="number" min="1" max="20" value={value.recovery_threshold} onChange={(event) => update('recovery_threshold', Number(event.target.value))} /></label>
    </div>
    <div className="form-two">
      <label>TCP PORT <span className="optional">OPTIONAL</span><input type="number" min="1" max="65535" value={value.tcp_port || ''} onChange={(event) => update('tcp_port', event.target.value ? Number(event.target.value) : null)} /></label>
      <label>HTTP(S) URL <span className="optional">OPTIONAL</span><input value={value.http_url || ''} placeholder="https://service.local/health" onChange={(event) => update('http_url', event.target.value || null)} /></label>
    </div>
    <div className="form-section-title">THROUGHPUT COLLECTION</div>
    <label className="toggle-row">RX / TX SPEED<input type="checkbox" checked={value.throughput_enabled} onChange={(event) => update('throughput_enabled', event.target.checked)} /><span /></label>
    <div className="form-hint">Uses SNMP first, then local Windows adapter fallback.</div>
    <div className="form-section-title">ACTIVE NODE DISPLAY</div>
    <label className="toggle-row">{value.snmp.client_discovery_enabled ? 'SHOW SNMP / ARP-OBSERVED NODE COUNT' : 'SHOW ARP-OBSERVED NODE COUNT'}<input type="checkbox" checked={value.active_nodes_visible} onChange={(event) => update('active_nodes_visible', event.target.checked)} /><span /></label>
    <div className="form-hint">{value.snmp.client_discovery_enabled ? 'Prefers standard SNMP tables and falls back to this Windows PC ARP cache; count is an estimate.' : 'Observed by this Windows PC ARP cache; count is an estimate, not a complete inventory.'}</div>
    <div className="form-section-title">SNMP CLIENT DISCOVERY</div>
    <label className="toggle-row">ENABLE SNMP DEVICE COUNT<input type="checkbox" checked={value.snmp.client_discovery_enabled} onChange={(event) => updateSnmp('client_discovery_enabled', event.target.checked)} /><span /></label>
    <div className="form-hint">Uses standard IP-MIB and BRIDGE-MIB tables when exposed by the router or switch. Deduplicates MACs, refreshes every 60 seconds, and falls back to Windows ARP.</div>
    <div className="form-section-title">SNMP INTERFACE COUNTERS (RX / TX)</div>
    <label className="toggle-row">ENABLE SNMP RX / TX COUNTERS<input type="checkbox" checked={value.snmp.enabled} onChange={(event) => updateSnmp('enabled', event.target.checked)} /><span /></label>
    {(value.snmp.enabled || value.snmp.client_discovery_enabled) && <>
      <label>SNMP HOST<input value={value.snmp.host || ''} onChange={(event) => updateSnmp('host', event.target.value || null)} required /></label>
      <div className="form-two">
        <label>SNMP PORT<input type="number" min="1" max="65535" value={value.snmp.port} onChange={(event) => updateSnmp('port', Number(event.target.value))} required /></label>
        <label>READ-ONLY COMMUNITY<input type="password" value={value.snmp.community || ''} onChange={(event) => updateSnmp('community', event.target.value || null)} required /></label>
      </div>
      {value.snmp.enabled && <>
        <label>IF INDEX<input type="number" min="1" value={value.snmp.interface_index || ''} onChange={(event) => updateSnmp('interface_index', event.target.value ? Number(event.target.value) : null)} required /></label>
        <label>COUNTER WIDTH<select value={value.snmp.counter_bits} onChange={(event) => updateSnmp('counter_bits', Number(event.target.value) as 32 | 64)}><option value="64">64-BIT (IF-MIB HIGH CAPACITY)</option><option value="32">32-BIT (IF-MIB)</option></select></label>
      </>}
    </>}
    <div className="form-section-title">VOICE ALERT MAPPING <span className="optional">AUDIO FOLDER: C:\CyberNOC\audio</span></div><AudioSelect label="DOWN ALERT" value={value.audio_down} files={files} allowNone onChange={(next) => update('audio_down', next)} onTest={onTestAudio} onUpload={onUploadAudio} /><AudioSelect label="RECOVERY ALERT" value={value.audio_recovered} files={files} allowNone onChange={(next) => update('audio_recovered', next)} onTest={onTestAudio} onUpload={onUploadAudio} /><AudioSelect label="REPEAT ALERT AUDIO" value={value.audio_reminder} files={files} allowNone onChange={(next) => update('audio_reminder', next)} onTest={onTestAudio} onUpload={onUploadAudio} /><label>REPEAT EVERY (MINUTES)<span className="optional">DEFAULT 30 · RANGE 1–1440</span><input type="number" min="1" max="1440" step="1" value={value.alert_repeat_minutes} onChange={(event) => update('alert_repeat_minutes', Number(event.target.value))} required /></label>
    <button className="save-button"><Check size={15} /> {isNew ? 'ADD MONITOR' : 'SAVE CHANGES'}</button>{!isNew && <button type="button" className="remove-button" onClick={onRemove}>REMOVE MONITOR</button>}</form>;
}

function AudioSelect({ label, value, files, allowNone, onChange, onTest, onUpload }: { label: string; value: string | null; files: string[]; allowNone: boolean; onChange: (value: string | null) => void; onTest: (file: string) => void; onUpload: (file: File) => Promise<string> }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  async function chooseAudio(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      onChange(await onUpload(file));
    } catch {
      // The parent displays the upload error in the dashboard notice.
    } finally {
      setUploading(false);
      input.value = '';
    }
  }
  return <div className="audio-select">
    <label>{label}<select value={value || ''} onChange={(event) => onChange(event.target.value || null)}>{allowNone && <option value="">NO AUDIO</option>}{files.map((file) => <option value={file} key={file}>{file}</option>)}</select></label>
    <input ref={fileInput} className="audio-file-input" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={(event) => void chooseAudio(event)} />
    <button type="button" className="audio-upload-button" title="Browse and save an MP3/WAV file" aria-label={`Browse audio file for ${label}`} disabled={uploading} onClick={() => fileInput.current?.click()}><Upload size={14} /></button>
    <button type="button" title="Test audio playback" aria-label={`Test ${label}`} disabled={!value} onClick={() => value && onTest(value)}><AudioLines size={14} /></button>
  </div>;
}