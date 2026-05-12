import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Loader2, RefreshCw, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from 'sonner';

type LogType = 'admin' | 'fxserver' | 'server';

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  family?: LogType;
}

interface LogFile {
  file: string;
  family: LogType;
  size: number;
  updatedAt: string;
}

const tabs: Array<{ value: LogType; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'fxserver', label: 'FXServer' },
  { value: 'server', label: 'Server Activity' },
];

export default function Logs() {
  const [active, setActive] = useState<LogType>('admin');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const token = useAuthStore(state => state.token);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: active, limit: '250' });
      if (query.trim()) params.set('query', query.trim());
      const [nextLogs, nextFiles] = await Promise.all([
        apiFetch(`/logs?${params.toString()}`),
        apiFetch(`/logs/files?type=${active}`).catch(() => []),
      ]);
      setLogs(Array.isArray(nextLogs) ? nextLogs : []);
      setFiles(Array.isArray(nextFiles) ? nextFiles : []);
    } catch (error: any) {
      toast.error('Failed to load logs', { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [active]);

  const levels = useMemo(() => {
    return logs.reduce<Record<string, number>>((acc, log) => {
      acc[log.level] = (acc[log.level] || 0) + 1;
      return acc;
    }, {});
  }, [logs]);

  const downloadFile = async (file: string) => {
    const response = await fetch(`/api/logs/files/${active}/${file}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      toast.error('Failed to download log file');
      return;
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 border-b border-zinc-800/50 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Logs</h1>
          <p className="text-sm text-zinc-500">Review durable Portside, FXServer, and server activity logs.</p>
        </div>
        <button
          onClick={fetchLogs}
          className="inline-flex items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-zinc-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActive(tab.value)}
              className={`rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${active === tab.value ? 'bg-orange-600/15 text-orange-400' : 'text-zinc-500 hover:text-zinc-200'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={event => {
            event.preventDefault();
            fetchLogs();
          }}
          className="relative min-w-0 lg:w-80"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search logs..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-orange-600/60"
          />
        </form>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(levels).slice(0, 4).map(([level, count]) => (
          <div key={level} className="rounded-lg border border-zinc-800 bg-[#111] p-4">
            <div className="text-xl font-semibold text-white">{count}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{level}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-h-[520px] overflow-hidden rounded-lg border border-zinc-800 bg-[#111]">
          <div className="border-b border-zinc-800 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Recent Entries
          </div>
          <div className="max-h-[640px] overflow-y-auto p-3 font-mono text-[11px]">
            {loading && (
              <div className="flex items-center gap-2 p-4 text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading logs...
              </div>
            )}
            {!loading && logs.length === 0 && <div className="p-4 text-zinc-600">No log entries found.</div>}
            {logs.map(log => (
              <div key={log.id} className="grid grid-cols-[72px_72px_96px_minmax(0,1fr)] gap-3 rounded px-2 py-1 text-zinc-300 hover:bg-zinc-900/70">
                <span className="text-zinc-600">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className={log.level === 'ERROR' ? 'text-red-400' : log.level === 'WARN' ? 'text-yellow-400' : 'text-zinc-400'}>{log.level}</span>
                <span className="truncate text-zinc-500">[{log.source}]</span>
                <span className="min-w-0 break-words">{log.message}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-[#111] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <FileText className="h-4 w-4 text-orange-500" />
            Files
          </h2>
          <div className="space-y-2">
            {files.map(file => (
              <button
                key={file.file}
                onClick={() => downloadFile(file.file)}
                className="flex w-full items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-300 hover:border-orange-600/40"
              >
                <span className="min-w-0 truncate">{file.file}</span>
                <Download className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              </button>
            ))}
            {files.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-600">No files yet.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
