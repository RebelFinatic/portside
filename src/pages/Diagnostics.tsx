import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  Download,
  FileWarning,
  HardDrive,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';

interface DiagnosticConfig {
  key: string;
  configured: boolean;
  value: string;
  length: number;
  secret: boolean;
}

interface DiagnosticsPayload {
  generatedAt: string;
  portside: {
    version: string;
    monitorVersion: string;
    commit: string | null;
    node: string;
    pid: number;
    cwd: string;
    uptime: string;
    memoryBytes: number;
    heapUsedBytes: number;
  };
  host: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
    cpuCount: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    uptime: string;
  };
  filesystem: {
    dataPath: HealthPath;
    logPath: HealthPath;
  };
  fxserver: {
    mode: string;
    state: string;
    enabled: boolean;
    pid: number | null;
    uptimeSeconds: number | null;
    crashCount: number;
    binaryConfigured: boolean;
    cwdConfigured: boolean;
    lastExitReason: string | null;
  };
  monitor: {
    installed: boolean;
    online: boolean;
    configured: boolean;
    lastHeartbeatAt: string | null;
    resourceName?: string;
    version?: string;
  };
  discord: {
    configured: boolean;
    enabled: boolean;
    connected: boolean;
    lastUpdateAt: string | null;
    lastError: string | null;
  };
  database: {
    mode: string;
    configured: boolean;
    connected: boolean;
    error: string | null;
  };
  hostStatus: {
    tokenConfigured: boolean;
    compatibilityAliasConfigured: boolean;
  };
  config: DiagnosticConfig[];
}

interface HealthPath {
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  isDirectory: boolean;
  updatedAt: string | null;
  error: string | null;
}

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const boolLabel = (value: boolean) => (value ? 'Yes' : 'No');

export default function Diagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const token = useAuthStore(state => state.token);

  const fetchDiagnostics = async () => {
    setLoading(true);
    try {
      setDiagnostics(await apiFetch('/diagnostics'));
    } catch (error: any) {
      toast.error('Failed to load diagnostics', { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const healthCards = useMemo(() => {
    if (!diagnostics) return [];
    return [
      {
        title: 'Portside',
        status: 'Healthy',
        ok: true,
        detail: `v${diagnostics.portside.version} ${diagnostics.portside.commit ? `(${diagnostics.portside.commit})` : ''}`,
        icon: <Activity className="h-4 w-4" />,
      },
      {
        title: 'FXServer',
        status: diagnostics.fxserver.state,
        ok: diagnostics.fxserver.state === 'online' || diagnostics.fxserver.mode === 'external',
        detail: diagnostics.fxserver.mode === 'managed' ? `pid ${diagnostics.fxserver.pid || 'none'}` : 'external mode',
        icon: <Server className="h-4 w-4" />,
      },
      {
        title: 'Monitor',
        status: diagnostics.monitor.online ? 'Online' : diagnostics.monitor.configured ? 'Offline' : 'Not configured',
        ok: diagnostics.monitor.online || !diagnostics.monitor.configured,
        detail: diagnostics.monitor.lastHeartbeatAt ? new Date(diagnostics.monitor.lastHeartbeatAt).toLocaleString() : 'no heartbeat',
        icon: diagnostics.monitor.online ? <ShieldCheck className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />,
      },
      {
        title: 'Logs',
        status: diagnostics.filesystem.logPath.writable ? 'Writable' : 'Issue',
        ok: diagnostics.filesystem.logPath.readable && diagnostics.filesystem.logPath.writable,
        detail: diagnostics.filesystem.logPath.path,
        icon: <HardDrive className="h-4 w-4" />,
      },
      {
        title: 'Discord',
        status: diagnostics.discord.connected ? 'Connected' : diagnostics.discord.configured ? 'Configured' : 'Off',
        ok: diagnostics.discord.connected || !diagnostics.discord.enabled,
        detail: diagnostics.discord.lastError || (diagnostics.discord.enabled ? 'waiting for bot connection' : 'disabled'),
        icon: <ShieldCheck className="h-4 w-4" />,
      },
      {
        title: 'Database',
        status: diagnostics.database.connected ? 'Connected' : diagnostics.database.mode,
        ok: diagnostics.database.connected || diagnostics.database.mode === 'mock',
        detail: diagnostics.database.error || (diagnostics.database.mode === 'mock' ? 'mock explorer mode' : 'ready'),
        icon: <Database className="h-4 w-4" />,
      },
    ];
  }, [diagnostics]);

  const downloadBundle = async () => {
    setDownloading(true);
    try {
      const response = await fetch('/api/diagnostics/bundle', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `portside-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error('Failed to download bundle', { description: error.message });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 border-b border-zinc-800/50 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Diagnostics</h1>
          <p className="text-sm text-zinc-500">Review runtime health and export a redacted support bundle.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchDiagnostics}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
          <button
            onClick={downloadBundle}
            disabled={downloading || !diagnostics}
            className="inline-flex items-center justify-center gap-2 rounded border border-orange-600/40 bg-orange-600/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-orange-300 hover:bg-orange-600/20 disabled:opacity-60"
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download Bundle
          </button>
        </div>
      </div>

      {loading && !diagnostics && (
        <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-zinc-800 bg-[#111] text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading diagnostics...
        </div>
      )}

      {diagnostics && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {healthCards.map(card => (
              <section key={card.title} className="rounded-lg border border-zinc-800 bg-[#111] p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{card.title}</div>
                    <div className="mt-1 truncate text-xl font-semibold text-white">{card.status}</div>
                  </div>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded border ${card.ok ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-red-500/20 bg-red-500/10 text-red-400'}`}>
                    {card.ok ? card.icon : <FileWarning className="h-4 w-4" />}
                  </div>
                </div>
                <p className="truncate text-xs text-zinc-500">{card.detail}</p>
              </section>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-lg border border-zinc-800 bg-[#111]">
              <div className="border-b border-zinc-800 px-4 py-3">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Redacted Configuration</h2>
              </div>
              <div className="max-h-[620px] overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[#151515] text-[10px] uppercase tracking-widest text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Key</th>
                      <th className="px-4 py-3 font-semibold">Value</th>
                      <th className="px-4 py-3 font-semibold">Configured</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {diagnostics.config.map(item => (
                      <tr key={item.key} className="hover:bg-zinc-950/70">
                        <td className="px-4 py-3 font-mono text-zinc-300">{item.key}</td>
                        <td className="max-w-[420px] truncate px-4 py-3 font-mono text-zinc-500">
                          {item.secret && item.configured ? `${item.value} (${item.length} chars)` : item.value || 'empty'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase ${item.configured ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-zinc-800 bg-zinc-950 text-zinc-500'}`}>
                            {item.configured && <CheckCircle2 className="h-3 w-3" />}
                            {boolLabel(item.configured)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="space-y-5">
              <InfoPanel title="Portside">
                <InfoRow label="Version" value={`v${diagnostics.portside.version}`} />
                <InfoRow label="Commit" value={diagnostics.portside.commit || 'unknown'} />
                <InfoRow label="Node" value={diagnostics.portside.node} />
                <InfoRow label="PID" value={String(diagnostics.portside.pid)} />
                <InfoRow label="Uptime" value={diagnostics.portside.uptime} />
                <InfoRow label="RSS" value={formatBytes(diagnostics.portside.memoryBytes)} />
                <InfoRow label="Heap" value={formatBytes(diagnostics.portside.heapUsedBytes)} />
              </InfoPanel>

              <InfoPanel title="Host">
                <InfoRow label="Platform" value={`${diagnostics.host.platform} ${diagnostics.host.release}`} />
                <InfoRow label="Arch" value={diagnostics.host.arch} />
                <InfoRow label="CPU" value={`${diagnostics.host.cpuCount} cores`} />
                <InfoRow label="Memory" value={`${formatBytes(diagnostics.host.freeMemoryBytes)} free`} />
                <InfoRow label="Uptime" value={diagnostics.host.uptime} />
              </InfoPanel>

              <InfoPanel title="Paths">
                <InfoRow label="Data" value={diagnostics.filesystem.dataPath.path} />
                <InfoRow label="Data writable" value={boolLabel(diagnostics.filesystem.dataPath.writable)} />
                <InfoRow label="Logs" value={diagnostics.filesystem.logPath.path} />
                <InfoRow label="Logs writable" value={boolLabel(diagnostics.filesystem.logPath.writable)} />
              </InfoPanel>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-[#111] p-4">
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-zinc-800/70 bg-black/20 px-3 py-2">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-600">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-xs text-zinc-300">{value}</span>
    </div>
  );
}
