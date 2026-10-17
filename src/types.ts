// BEL Cyber Network Operations Status — shared frontend telemetry contracts.
export type MonitorType = 'sap_intranet' | 'internet' | 'server' | 'other';
export type MonitorStatus = 'unknown' | 'online' | 'degraded' | 'down' | 'disabled' | 'gateway_down' | 'upstream_down' | 'application_down';

export interface MonitorConfig {
  id: string;
  name: string;
  type: MonitorType;
  custom_type: string | null;
  enabled: boolean;
  gateway_ip: string;
  target: string;
  interval_seconds: number;
  timeout_ms: number;
  failure_threshold: number;
  recovery_threshold: number;
  latency_warning_ms: number;
  packet_loss_warning_pct: number;
  source_ip: string | null;
  throughput_enabled: boolean;
  tcp_port: number | null;
  http_url: string | null;
  snmp: { enabled: boolean; host: string | null; port: number; community: string | null; interface_index: number | null; counter_bits: 32 | 64 };
  audio_down: string | null;
  audio_recovered: string | null;
  audio_reminder: string | null;
  alert_repeat_minutes: number;
}

export interface Sample {
  checked_at: string;
  status: MonitorStatus;
  latency_ms: number | null;
  packet_loss_pct: number | null;
  rx_bps: number | null;
  tx_bps: number | null;
}

export interface MonitorView {
  config: MonitorConfig;
  status: MonitorStatus;
  failure_count: number;
  last_check: string | null;
  gateway_reachable: boolean | null;
  target_reachable: boolean | null;
  gateway_latency_ms: number | null;
  latency_ms: number | null;
  packet_loss_pct: number | null;
  rx_bps: number | null;
  tx_bps: number | null;
  uptime_pct_24h: number | null;
  route_strategy: string;
  history: Sample[];
}

export interface EventItem {
  id: number;
  monitor_id: string;
  monitor_name: string;
  occurred_at: string;
  kind: string;
  detail: string;
  resolved_at?: string | null;
}

export interface DashboardData {
  monitors: MonitorView[];
  events: EventItem[];
  server_time: string;
  system?: SystemMetrics;
}

export interface SystemMetrics {
  cpu_percent: number | null;
  ram_used_bytes: number | null;
  ram_total_bytes: number | null;
  ram_percent: number | null;
  storage_used_bytes: number | null;
  storage_total_bytes: number | null;
  storage_percent: number | null;
  sampled_at: string | null;
}