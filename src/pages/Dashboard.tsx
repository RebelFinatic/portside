import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Database,
  FileCode2,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldX,
  Square,
  TerminalSquare,
  Users,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDistanceToNowStrict } from 'date-fns';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { useAuthStore } from '../store/useAuthStore';
import ConfirmModal from '../components/ConfirmModal';

interface ServerStatus {
  online: boolean;
  players: number;
  maxPlayers: number;
  cpuUsage: number;
  memoryUsage: number;
  uptime: string;
  metrics?: {
    process?: {
      memoryBytes?: number;
      heapUsedBytes?: number;
    };
    host?: {
      memoryUsage?: number;
      cpuCount?: number;
    };
  };
  fxserver?: FxServerStatus;
}

interface FxServerStatus {
  mode: 'external' | 'managed';
  state: string;
  enabled: boolean;
  pid: number | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  crashCount: number;
  restartOnCrash: boolean;
  lastExitReason: string | null;
  binaryConfigured: boolean;
  cwdConfigured: boolean;
}

interface RestartSchedule {
  id: string;
  name: string;
  enabled: boolean;
  type: 'daily' | 'temporary';
  timeOfDay: string | null;
  executeAt: string | null;
  daysOfWeek?: number[];
  nextOccurrenceAt: string | null;
  message: string | null;
}

interface Player {
  id: number;
  name: string;
  ping?: number;
  role?: string;
}

interface Resource {
  name: string;
  state: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  source: string;
}

interface MetricSample {
  time: string;
  players: number;
  cpu: number;
  memory: number;
}

const chartText = '#71717a';
const gridStroke = '#27272a';
const dayOptions = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];
type DashboardTab = 'overview' | 'resources' | 'players' | 'activity';

export default function Dashboard() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [fxStatus, setFxStatus] = useState<FxServerStatus | null>(null);
  const [restartSchedules, setRestartSchedules] = useState<RestartSchedule[]>([]);
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [controlAction, setControlAction] = useState<string | null>(null);
  const [pendingControlAction, setPendingControlAction] = useState<'stop' | 'restart' | null>(null);
  const [controlReason, setControlReason] = useState('Routine server maintenance');
  const [scheduleTime, setScheduleTime] = useState('06:00');
  const [scheduleMessage, setScheduleMessage] = useState('Scheduled restart by Portside');
  const [scheduleDays, setScheduleDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [chartsOpen, setChartsOpen] = useState(true);
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const hasServerControl = useAuthStore(state => state.hasPermission('control.server'));
  const hasSettingsView = useAuthStore(state => state.hasPermission('settings.view'));

  const fetchDashboard = async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);

    try {
      const [nextStatus, nextPlayers, nextResources, nextLogs, nextControl, nextRestarts] = await Promise.all([
        apiFetch('/server/status'),
        apiFetch('/players'),
        apiFetch('/resources'),
        apiFetch('/logs'),
        hasServerControl ? apiFetch('/server/control/status') : Promise.resolve(null),
        hasServerControl ? apiFetch('/server/restarts') : Promise.resolve([]),
      ]);

      setStatus(nextStatus);
      setPlayers(Array.isArray(nextPlayers) ? nextPlayers : []);
      setResources(Array.isArray(nextResources) ? nextResources : []);
      setLogs(Array.isArray(nextLogs) ? nextLogs : []);
      setFxStatus(nextControl || nextStatus.fxserver || null);
      setRestartSchedules(Array.isArray(nextRestarts) ? nextRestarts : []);
      setLastUpdated(new Date());
      setSamples(prev => [
        ...prev.slice(-35),
        {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          players: nextStatus.players || 0,
          cpu: nextStatus.cpuUsage || 0,
          memory: nextStatus.memoryUsage || 0,
        },
      ]);
    } catch (error) {
      if (!silent) {
        toast.error('Failed to refresh dashboard');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    const interval = window.setInterval(() => fetchDashboard({ silent: true }), 5000);
    return () => window.clearInterval(interval);
  }, [hasServerControl]);

  const managedControlsEnabled = fxStatus?.mode === 'managed' && fxStatus?.enabled !== false;

  const requestControlAction = (action: 'start' | 'stop' | 'restart') => {
    if (!managedControlsEnabled) {
      toast.error('Server lifecycle controls require managed FXServer mode');
      return;
    }
    if (action === 'stop' || action === 'restart') {
      const reason = controlReason.trim();
      if (!reason) {
        toast.error('Reason is required');
        return;
      }
      setPendingControlAction(action);
      return;
    }
    void runControlAction(action);
  };

  const runControlAction = async (action: 'start' | 'stop' | 'restart') => {
    const reason = controlReason.trim();
    if ((action === 'stop' || action === 'restart') && !reason) {
      toast.error('Reason is required');
      return;
    }

    setPendingControlAction(null);
    setControlAction(action);
    try {
      const nextStatus = await apiFetch(`/server/control/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || 'Started from Portside' }),
      });
      setFxStatus(nextStatus);
      toast.success(`Server ${action} request completed`);
    } catch (error: any) {
      toast.error(error.message || `Failed to ${action} server`);
    } finally {
      setControlAction(null);
    }
  };

  const createDailyRestart = async () => {
    if (scheduleDays.length === 0) {
      toast.error('Select at least one day for the restart schedule');
      return;
    }
    try {
      const schedule = await apiFetch('/server/restarts', {
        method: 'POST',
        body: JSON.stringify({
          name: `Daily restart ${scheduleTime}`,
          timeOfDay: scheduleTime,
          daysOfWeek: scheduleDays,
          message: scheduleMessage,
        }),
      });
      setRestartSchedules(prev => [schedule, ...prev]);
      toast.success('Restart schedule created');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create restart schedule');
    }
  };

  const skipRestart = async (id: string) => {
    try {
      await apiFetch(`/server/restarts/${id}/skip-next`, { method: 'POST' });
      toast.success('Next restart skipped');
      const schedules = await apiFetch('/server/restarts');
      setRestartSchedules(Array.isArray(schedules) ? schedules : []);
    } catch (error: any) {
      toast.error(error.message || 'Failed to skip restart');
    }
  };

  const runningResources = resources.filter(resource => resource.state === 'started').length;
  const stoppedResources = Math.max(resources.length - runningResources, 0);
  const playerCapacity = status?.maxPlayers ? Math.round(((status.players || 0) / status.maxPlayers) * 100) : 0;
  const avgPing = players.length
    ? Math.round(players.reduce((total, player) => total + (player.ping || 0), 0) / players.length)
    : 0;

  const logStats = useMemo(() => {
    const counts = { errors: 0, warnings: 0, commands: 0, info: 0 };

    logs.forEach(log => {
      if (log.level === 'ERROR') counts.errors += 1;
      else if (log.level === 'WARN') counts.warnings += 1;
      else if (log.level === 'COMMAND') counts.commands += 1;
      else counts.info += 1;
    });

    return counts;
  }, [logs]);

  const logChartData = [
    { name: 'Info', value: logStats.info, fill: '#71717a' },
    { name: 'Warn', value: logStats.warnings, fill: '#eab308' },
    { name: 'Error', value: logStats.errors, fill: '#ef4444' },
    { name: 'Cmd', value: logStats.commands, fill: '#a855f7' },
  ];

  const recentLogs = logs.slice(0, 6);
  const recentPlayers = [...players].sort((a, b) => (a.ping || 0) - (b.ping || 0)).slice(0, 6);

  const alerts = useMemo(() => {
    const items: { tone: 'red' | 'yellow' | 'orange'; message: string; href?: string }[] = [];
    if (status && !status.online) {
      items.push({ tone: 'red', message: 'Server is offline or not responding to health checks.', href: '/diagnostics' });
    }
    if (logStats.errors > 0) {
      items.push({ tone: 'yellow', message: `${logStats.errors} error${logStats.errors === 1 ? '' : 's'} in recent logs.`, href: '/console' });
    }
    if ((fxStatus?.crashCount || 0) > 0) {
      items.push({ tone: 'orange', message: `FXServer has recorded ${fxStatus?.crashCount} crash${fxStatus?.crashCount === 1 ? '' : 'es'}.`, href: '/logs' });
    }
    if (fxStatus?.lastExitReason) {
      items.push({ tone: 'orange', message: `Last exit reason: ${fxStatus.lastExitReason}` });
    }
    return items;
  }, [status, logStats.errors, fxStatus?.crashCount, fxStatus?.lastExitReason]);

  const toggleScheduleDay = (day: number) => {
    setScheduleDays(current => (
      current.includes(day)
        ? current.filter(value => value !== day)
        : [...current, day].sort((a, b) => a - b)
    ));
  };

  if (loading && !status) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
          Loading live dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col relative w-full h-full p-6 lg:p-8 overflow-y-auto overflow-x-hidden">
      <section className="mb-6 rounded-xl border border-zinc-800 bg-[#111] p-5 lg:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-14 w-14 items-center justify-center rounded-xl border ${status?.online ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
              <Server className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white m-0">FiveM Server</h1>
                <span className={`inline-flex items-center gap-2 rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${status?.online ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${status?.online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  {status?.online ? 'Online' : 'Offline'}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                {lastUpdated ? `Updated ${formatDistanceToNowStrict(lastUpdated, { addSuffix: true })}` : 'Waiting for first refresh'}
                {status?.uptime ? ` · Uptime ${status.uptime}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-center sm:text-left">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Players</div>
              <div className="mt-1 text-3xl font-semibold text-white">{status?.players ?? 0}<span className="text-lg text-zinc-500">/{status?.maxPlayers ?? 0}</span></div>
            </div>
            <button
              onClick={() => fetchDashboard()}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-60"
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" /> : <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />}
              Refresh
            </button>
          </div>
        </div>

        {hasServerControl && managedControlsEnabled && (
          <div className="mt-5 flex flex-col gap-3 border-t border-zinc-800/70 pt-5 lg:flex-row lg:items-center">
            <input
              value={controlReason}
              onChange={event => setControlReason(event.target.value)}
              className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-600"
              placeholder="Reason for stop/restart"
            />
            <div className="grid grid-cols-3 gap-2">
              <ControlButton label="Start" icon={<Play className="h-3.5 w-3.5" />} loading={controlAction === 'start'} onClick={() => requestControlAction('start')} />
              <ControlButton label="Stop" icon={<Square className="h-3.5 w-3.5" />} loading={controlAction === 'stop'} onClick={() => requestControlAction('stop')} danger />
              <ControlButton label="Restart" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={controlAction === 'restart'} onClick={() => requestControlAction('restart')} />
            </div>
          </div>
        )}
      </section>

      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.map(alert => (
            <div
              key={alert.message}
              className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
                alert.tone === 'red'
                  ? 'border-red-500/30 bg-red-500/10 text-red-200'
                  : alert.tone === 'yellow'
                    ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-100'
                    : 'border-orange-500/30 bg-orange-500/10 text-orange-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{alert.message}</span>
              </div>
              {alert.href && (
                <Link to={alert.href} className="shrink-0 text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white">
                  View
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Users className="h-5 w-5" />}
          label="Players"
          value={`${status?.players ?? 0}/${status?.maxPlayers ?? 0}`}
          detail={`${playerCapacity}% capacity`}
          tone="blue"
          progress={playerCapacity}
        />
        <MetricCard
          icon={<Cpu className="h-5 w-5" />}
          label="CPU"
          value={`${status?.cpuUsage ?? 0}%`}
          detail={`${status?.metrics?.host?.cpuCount || 0} host threads sampled by Portside`}
          tone="orange"
          progress={status?.cpuUsage ?? 0}
        />
        <MetricCard
          icon={<HardDrive className="h-5 w-5" />}
          label="Memory"
          value={`${status?.memoryUsage ?? 0}%`}
          detail={`${Math.round((status?.metrics?.process?.memoryBytes || 0) / 1024 / 1024)} MB Portside RSS`}
          tone="violet"
          progress={status?.memoryUsage ?? 0}
        />
        <MetricCard
          icon={<Clock className="h-5 w-5" />}
          label="Resources Running"
          value={`${runningResources}/${resources.length || 0}`}
          detail={`${stoppedResources} stopped · ${avgPing || 0}ms avg ping`}
          tone="green"
          progress={resources.length ? Math.round((runningResources / resources.length) * 100) : 0}
        />
      </div>

      <Panel title="Server Snapshot" subtitle="Switch tabs to focus on one area at a time" icon={<Activity className="h-4 w-4" />}>
        <div className="mb-5 flex flex-wrap gap-2">
          {([
            ['overview', 'Overview'],
            ['resources', 'Resources'],
            ['players', 'Players'],
            ['activity', 'Activity'],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setDashboardTab(tab)}
              className={`rounded border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                dashboardTab === tab
                  ? 'border-orange-600/40 bg-orange-600/10 text-orange-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {dashboardTab === 'overview' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div>
              <div className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Resources</div>
              <div className="grid grid-cols-2 gap-3">
                <SmallStat label="Started" value={runningResources} tone="text-emerald-400" />
                <SmallStat label="Stopped" value={stoppedResources} tone="text-zinc-400" />
              </div>
              <div className="mt-4 space-y-2">
                {resources.slice(0, 4).map(resource => (
                  <StatusRow key={resource.name} label={resource.name} value={resource.state} active={resource.state === 'started'} />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Players</div>
              <div className="space-y-2">
                {recentPlayers.slice(0, 4).map(player => (
                  <PlayerRow key={player.id} player={player} />
                ))}
                {recentPlayers.length === 0 && <EmptyLine>No active players.</EmptyLine>}
              </div>
            </div>
            <div>
              <div className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Recent Activity</div>
              <div className="space-y-2">
                {recentLogs.slice(0, 4).map(log => (
                  <LogRow key={log.id} log={log} />
                ))}
                {recentLogs.length === 0 && <EmptyLine>No recent logs.</EmptyLine>}
              </div>
            </div>
          </div>
        )}

        {dashboardTab === 'resources' && (
          <div className="space-y-2">
            {resources.map(resource => (
              <StatusRow key={resource.name} label={resource.name} value={resource.state} active={resource.state === 'started'} />
            ))}
            {resources.length === 0 && <EmptyLine>No resources reported yet.</EmptyLine>}
          </div>
        )}

        {dashboardTab === 'players' && (
          <div className="space-y-2">
            {players.map(player => (
              <PlayerRow key={player.id} player={player} />
            ))}
            {players.length === 0 && <EmptyLine>No active players.</EmptyLine>}
          </div>
        )}

        {dashboardTab === 'activity' && (
          <div className="space-y-2">
            {logs.slice(0, 12).map(log => (
              <LogRow key={log.id} log={log} />
            ))}
            {logs.length === 0 && <EmptyLine>No recent logs.</EmptyLine>}
          </div>
        )}
      </Panel>

      <div className="my-6">
        <button
          type="button"
          onClick={() => setChartsOpen(current => !current)}
          className="mb-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white"
        >
          {chartsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Performance Graphs
        </button>

        {chartsOpen && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
            <Panel title="Live Utilization" subtitle="Session samples from dashboard polling" icon={<Activity className="h-4 w-4" />}>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={samples} margin={{ top: 8, right: 10, left: -24, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ea580c" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ea580c" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="playerGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="time" hide />
                    <YAxis stroke={chartText} fontSize={11} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#27272a', borderRadius: '8px', fontSize: '12px' }}
                      itemStyle={{ color: '#d4d4d8' }}
                    />
                    <Area type="monotone" dataKey="cpu" name="CPU %" stroke="#ea580c" strokeWidth={2} fill="url(#cpuGradient)" />
                    <Area type="monotone" dataKey="memory" name="Memory %" stroke="#a855f7" strokeWidth={2} fill="url(#memoryGradient)" />
                    <Area type="monotone" dataKey="players" name="Players" stroke="#3b82f6" strokeWidth={2} fill="url(#playerGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Log Health" subtitle="Last 100 server log entries" icon={<AlertTriangle className="h-4 w-4" />}>
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={logChartData} margin={{ top: 8, right: 8, left: -28, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="name" stroke={chartText} fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke={chartText} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#27272a', borderRadius: '8px', fontSize: '12px' }}
                      cursor={{ fill: '#27272a', opacity: 0.35 }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <SmallStat label="Warnings" value={logStats.warnings} tone="text-yellow-400" />
                <SmallStat label="Errors" value={logStats.errors} tone="text-red-400" />
              </div>
            </Panel>
          </div>
        )}
      </div>

      {hasServerControl && (
        <div className="mb-6">
          <Panel
            title="Server Control"
            subtitle={fxStatus?.mode === 'managed' ? 'Managed FXServer lifecycle and restart schedules' : 'External mode: lifecycle controls disabled'}
            icon={<Server className="h-4 w-4" />}
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SmallStat label="Mode" value={fxStatus?.mode || 'external'} tone={fxStatus?.mode === 'managed' ? 'text-emerald-400' : 'text-zinc-400'} />
              <SmallStat label="State" value={fxStatus?.state || 'external'} tone={fxStatus?.state === 'online' ? 'text-emerald-400' : 'text-orange-400'} />
              <SmallStat label="PID" value={fxStatus?.pid || 'none'} tone="text-blue-400" />
              <SmallStat label="Crashes" value={fxStatus?.crashCount ?? 0} tone="text-red-400" />
            </div>

            {!managedControlsEnabled && (
              <p className="mt-4 text-xs text-zinc-500">
                Start/stop/restart are only available when Portside runs FXServer in managed mode.
              </p>
            )}

            <button
              type="button"
              onClick={() => setSchedulerOpen(current => !current)}
              className="mt-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white"
            >
              {schedulerOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <CalendarClock className="h-4 w-4" />
              Restart Scheduler
            </button>

            {schedulerOpen && (
              <div className="mt-4 space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)_auto]">
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={event => setScheduleTime(event.target.value)}
                    className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-600"
                  />
                  <input
                    value={scheduleMessage}
                    onChange={event => setScheduleMessage(event.target.value)}
                    className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-orange-600"
                    placeholder="Warning message"
                  />
                  <button onClick={createDailyRestart} className="rounded border border-orange-700/60 bg-orange-600/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-orange-300 hover:bg-orange-600/20">
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dayOptions.map(day => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleScheduleDay(day.value)}
                      className={`rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                        scheduleDays.includes(day.value)
                          ? 'border-orange-600/40 bg-orange-600/10 text-orange-300'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-500'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {restartSchedules.slice(0, 5).map(schedule => (
                    <div key={schedule.id} className="flex items-center justify-between gap-3 rounded border border-zinc-800/70 bg-black/20 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{schedule.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-600">
                          {schedule.type}
                          {schedule.daysOfWeek?.length ? ` · ${schedule.daysOfWeek.map(day => dayOptions.find(option => option.value === day)?.label || day).join(', ')}` : ''}
                          {' · '}
                          {schedule.nextOccurrenceAt ? new Date(schedule.nextOccurrenceAt).toLocaleString() : 'disabled'}
                        </div>
                      </div>
                      <button onClick={() => skipRestart(schedule.id)} className="shrink-0 rounded border border-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:border-orange-600/50 hover:text-orange-300">
                        Skip
                      </button>
                    </div>
                  ))}
                  {restartSchedules.length === 0 && <EmptyLine>No restart schedules configured.</EmptyLine>}
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      <Panel title="Operations" subtitle="Fast paths to common server work" icon={<Zap className="h-4 w-4" />}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction to="/console" icon={<TerminalSquare className="h-4 w-4" />} title="Open Console" description="Run RCON commands and inspect output." />
          <QuickAction to="/players" icon={<Users className="h-4 w-4" />} title="Manage Players" description="Review online players, kicks, and bans." />
          <QuickAction to="/bans" icon={<ShieldX className="h-4 w-4" />} title="Ban Manager" description="Browse active bans and revoke them quickly." />
          <QuickAction to="/resources" icon={<Server className="h-4 w-4" />} title="Control Resources" description="Start, stop, and restart scripts." />
          <QuickAction to="/settings" icon={<FileCode2 className="h-4 w-4" />} title="Edit server.cfg" description="Update the active FiveM config file." />
          <QuickAction to="/database" icon={<Database className="h-4 w-4" />} title="Explore Database" description="Inspect tables and run admin queries." />
          {hasSettingsView && <QuickAction to="/diagnostics" icon={<Activity className="h-4 w-4" />} title="Diagnostics" description="Check runtime health and export a support bundle." />}
        </div>
      </Panel>

      <ConfirmModal
        open={pendingControlAction === 'stop'}
        title="Stop FXServer?"
        description="This will stop the managed FXServer process. All connected players will be disconnected."
        confirmLabel="Stop Server"
        danger
        loading={controlAction === 'stop'}
        onConfirm={() => runControlAction('stop')}
        onCancel={() => setPendingControlAction(null)}
      />

      <ConfirmModal
        open={pendingControlAction === 'restart'}
        title="Restart FXServer?"
        description="This will restart the managed FXServer process. Players may be disconnected during the restart."
        confirmLabel="Restart Server"
        danger
        loading={controlAction === 'restart'}
        onConfirm={() => runControlAction('restart')}
        onCancel={() => setPendingControlAction(null)}
      />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
  progress = 0,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'blue' | 'orange' | 'violet' | 'green';
  progress?: number;
}) {
  const toneClass = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    orange: 'bg-orange-600/10 text-orange-500 border-orange-600/20',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  }[tone];

  const barClass = {
    blue: progress >= 90 ? 'bg-red-500' : progress >= 75 ? 'bg-yellow-500' : 'bg-blue-500',
    orange: progress >= 90 ? 'bg-red-500' : progress >= 75 ? 'bg-yellow-500' : 'bg-orange-500',
    violet: progress >= 90 ? 'bg-red-500' : progress >= 75 ? 'bg-yellow-500' : 'bg-violet-500',
    green: progress >= 90 ? 'bg-red-500' : progress >= 75 ? 'bg-yellow-500' : 'bg-emerald-500',
  }[tone];

  return (
    <section className="rounded-lg border border-zinc-800 bg-[#111] p-5">
      <div className="flex items-center gap-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg border ${toneClass}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
          <div className="mt-1 truncate text-2xl font-semibold text-white">{value}</div>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded bg-zinc-900">
        <div className={`h-full transition-all ${barClass}`} style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }} />
      </div>
      <div className="mt-3 text-xs text-zinc-500">{detail}</div>
    </section>
  );
}

function Panel({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-[#111] p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <span className="text-orange-500">{icon}</span>
            {title}
          </h2>
          <p className="mt-1 text-xs text-zinc-600">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function SmallStat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className={`text-xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">{label}</div>
    </div>
  );
}

function StatusRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-zinc-800/70 bg-black/20 px-3 py-2">
      <span className="truncate text-sm text-zinc-300">{label}</span>
      <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${active ? 'text-emerald-400' : 'text-zinc-500'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        {value}
      </span>
    </div>
  );
}

function PlayerRow({ player }: { player: Player }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-zinc-800/70 bg-black/20 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white">{player.name}</div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-600">{player.role || 'player'}</div>
      </div>
      <span className="font-mono text-xs text-zinc-400">{player.ping ?? 0}ms</span>
    </div>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  const color = log.level === 'ERROR'
    ? 'text-red-400'
    : log.level === 'WARN'
      ? 'text-yellow-400'
      : log.level === 'COMMAND'
        ? 'text-violet-400'
        : 'text-zinc-400';

  return (
    <div className="rounded border border-zinc-800/70 bg-black/20 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{log.level}</span>
        <span className="font-mono text-[10px] text-zinc-600">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <p className="line-clamp-1 text-xs text-zinc-400">{log.message}</p>
    </div>
  );
}

function QuickAction({ to, icon, title, description }: { to: string; icon: ReactNode; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="group flex min-h-[104px] items-start justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 transition-colors hover:border-orange-600/30 hover:bg-orange-600/5"
    >
      <div className="min-w-0">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded border border-zinc-800 bg-black/30 text-zinc-400 group-hover:border-orange-600/30 group-hover:text-orange-500">
          {icon}
        </div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-orange-500" />
    </Link>
  );
}

function ControlButton({
  label,
  icon,
  loading,
  danger,
  disabled,
  title,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  loading: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-2 rounded border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-60 ${
        danger
          ? 'border-red-900/70 bg-red-950/30 text-red-300 hover:border-red-700'
          : 'border-zinc-800 bg-zinc-950 text-zinc-200 hover:border-orange-600/50 hover:text-orange-300'
      }`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">
      {children}
    </div>
  );
}
