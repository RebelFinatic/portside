import React, {useEffect, useMemo, useState} from 'react';
import {
  AlertTriangle,
  FileText,
  FolderSearch,
  Info,
  Layers,
  Loader2,
  PanelRightOpen,
  Play,
  RefreshCw,
  Search,
  Square,
  Upload,
  X,
} from 'lucide-react';
import {toast} from 'sonner';
import {apiFetch} from '../lib/api';

type ResourceAction = 'start' | 'stop' | 'restart';

interface Resource {
  name: string;
  state: string;
  version?: string;
  author?: string;
  description?: string;
  dependencies?: string[];
  logs?: string;
}

interface PendingAction {
  resource: Resource;
  action: ResourceAction;
}

const actionCopy: Record<ResourceAction, {title: string; body: string; cta: string}> = {
  start: {
    title: 'Start Resource',
    body: 'Start this resource and make it available to the live server.',
    cta: 'Start Resource',
  },
  stop: {
    title: 'Stop Resource',
    body: 'Stop this resource for connected players. Active sessions that depend on it may be interrupted.',
    cta: 'Stop Resource',
  },
  restart: {
    title: 'Restart Resource',
    body: 'Restart this resource and reload its runtime state. Players using related features may see a brief interruption.',
    cta: 'Restart Resource',
  },
};

export default function Resources() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    setRefreshing(true);
    try {
      const data = await apiFetch('/resources');
      setResources(data);
      setSelectedName(current => current ?? data[0]?.name ?? null);
    } catch {
      toast.error('Failed to load resources');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const runAction = async (resource: Resource, action: ResourceAction) => {
    const {name} = resource;
    setActionLoading(prev => ({...prev, [name]: action}));
    const originalState = resources.find(r => r.name === name)?.state;

    if (action === 'start' || action === 'restart') {
      setResources(prev => prev.map(r => r.name === name ? {...r, state: 'started'} : r));
    } else {
      setResources(prev => prev.map(r => r.name === name ? {...r, state: 'stopped'} : r));
    }

    try {
      await apiFetch(`/resources/${name}/${action}`, {method: 'POST'});
      toast.success(`${actionCopy[action].cta.replace(' Resource', '')} complete`, {
        description: name,
      });
    } catch {
      toast.error(`Failed to ${action} resource`, {
        description: name,
      });
      setResources(prev => prev.map(r => r.name === name ? {...r, state: originalState || r.state} : r));
    } finally {
      setActionLoading(prev => ({...prev, [name]: ''}));
      setPendingAction(null);
    }
  };

  const filteredResources = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return resources;

    return resources.filter(res => (
      res.name.toLowerCase().includes(query) ||
      (res.author || '').toLowerCase().includes(query) ||
      (res.description || '').toLowerCase().includes(query)
    ));
  }, [resources, searchQuery]);

  const selectedResource = filteredResources.find(res => res.name === selectedName) || filteredResources[0] || null;
  const startedCount = resources.filter(res => res.state === 'started').length;
  const stoppedCount = Math.max(resources.length - startedCount, 0);

  const requestAction = (resource: Resource, action: ResourceAction) => {
    if (action === 'start') {
      runAction(resource, action);
      return;
    }
    setPendingAction({resource, action});
  };

  return (
    <div className="flex-1 flex flex-col p-6 lg:p-8 min-h-0">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between pb-6 gap-4 border-b border-zinc-800/50 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Script Manager</h1>
          <p className="text-sm text-zinc-500">Scan, operate, and inspect live FiveM resources.</p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search scripts, authors, descriptions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/70 transition-colors"
            />
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={fetchResources}
              disabled={refreshing}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white hover:border-zinc-700 transition-colors font-medium disabled:opacity-60"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> : <RefreshCw className="h-4 w-4 text-zinc-400" />}
              Rescan
            </button>
            <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-orange-600/10 border border-orange-600/20 rounded-lg text-sm font-semibold text-orange-500 hover:bg-orange-600/20 transition-colors">
              <Upload className="h-4 w-4" /> Upload
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 min-h-0">
        <div className="bg-[#101010] border border-zinc-800 rounded-lg overflow-hidden min-h-[520px] flex flex-col">
          <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800 bg-zinc-950/70">
            <ResourceStat label="Total Resources" value={resources.length} tone="text-white" />
            <ResourceStat label="Running" value={startedCount} tone="text-emerald-400" />
            <ResourceStat label="Stopped" value={stoppedCount} tone="text-zinc-400" />
          </div>

          <div className="hidden lg:grid grid-cols-[minmax(220px,1.4fr)_120px_120px_minmax(180px,1fr)_132px] gap-4 px-5 py-3 border-b border-zinc-800 bg-zinc-900/60">
            <ColumnLabel>Name</ColumnLabel>
            <ColumnLabel>Status</ColumnLabel>
            <ColumnLabel>Version</ColumnLabel>
            <ColumnLabel>Maintainer</ColumnLabel>
            <ColumnLabel align="text-right">Actions</ColumnLabel>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <ResourceLoadingState />
            ) : filteredResources.length === 0 ? (
              <ResourceEmptyState hasQuery={searchQuery.trim().length > 0} />
            ) : (
              filteredResources.map(resource => {
                const isSelected = selectedResource?.name === resource.name;
                const isRunning = resource.state === 'started';
                const currentAction = actionLoading[resource.name];

                return (
                  <button
                    key={resource.name}
                    onClick={() => setSelectedName(resource.name)}
                    className={`w-full text-left grid grid-cols-1 lg:grid-cols-[minmax(220px,1.4fr)_120px_120px_minmax(180px,1fr)_132px] gap-3 lg:gap-4 px-5 py-4 border-b border-zinc-800/70 transition-colors group ${
                      isSelected ? 'bg-orange-500/[0.06]' : 'hover:bg-zinc-900/70'
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <span className={`h-9 w-1 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-white">{resource.name}</h3>
                          <PanelRightOpen className={`h-3.5 w-3.5 ${isSelected ? 'text-orange-400' : 'text-zinc-600 group-hover:text-zinc-400'}`} />
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 line-clamp-1">
                          {resource.description || 'No manifest description provided.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex lg:block items-center justify-between">
                      <MobileLabel>Status</MobileLabel>
                      <StatusBadge state={resource.state} />
                    </div>
                    <div className="flex lg:block items-center justify-between">
                      <MobileLabel>Version</MobileLabel>
                      <span className="font-mono text-xs text-zinc-400">{resource.version ? `v${resource.version}` : 'unknown'}</span>
                    </div>
                    <div className="flex lg:block items-center justify-between min-w-0">
                      <MobileLabel>Maintainer</MobileLabel>
                      <span className="font-mono text-xs text-zinc-500 truncate">{resource.author || 'unassigned'}</span>
                    </div>
                    <div className="flex justify-end gap-2" onClick={event => event.stopPropagation()}>
                      {isRunning ? (
                        <IconAction
                          label="Stop"
                          tone="danger"
                          disabled={!!currentAction}
                          onClick={() => requestAction(resource, 'stop')}
                          icon={currentAction === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                        />
                      ) : (
                        <IconAction
                          label="Start"
                          tone="success"
                          disabled={!!currentAction}
                          onClick={() => requestAction(resource, 'start')}
                          icon={currentAction === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        />
                      )}
                      <IconAction
                        label="Restart"
                        tone="neutral"
                        disabled={!!currentAction}
                        onClick={() => requestAction(resource, 'restart')}
                        icon={currentAction === 'restart' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <ResourceDrawer resource={selectedResource} />
      </div>

      {pendingAction && (
        <DangerConfirmModal
          action={pendingAction.action}
          resource={pendingAction.resource}
          loading={actionLoading[pendingAction.resource.name] === pendingAction.action}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => runAction(pendingAction.resource, pendingAction.action)}
        />
      )}
    </div>
  );
}

function ResourceStat({label, value, tone}: {label: string; value: number; tone: string}) {
  return (
    <div className="px-5 py-4">
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{label}</div>
    </div>
  );
}

function ColumnLabel({children, align = 'text-left'}: {children: React.ReactNode; align?: string}) {
  return <div className={`text-[10px] uppercase tracking-widest text-zinc-500 font-bold ${align}`}>{children}</div>;
}

function MobileLabel({children}: {children: React.ReactNode}) {
  return <span className="lg:hidden text-[10px] uppercase tracking-widest text-zinc-600 font-bold">{children}</span>;
}

function StatusBadge({state}: {state: string}) {
  const isRunning = state === 'started';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] uppercase tracking-wider font-bold ${
      isRunning
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        : 'bg-zinc-800 text-zinc-400 border-zinc-700'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
      {state}
    </span>
  );
}

function IconAction({
  label,
  icon,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  tone: 'success' | 'danger' | 'neutral';
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass = {
    success: 'hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/10',
    danger: 'hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10',
    neutral: 'hover:text-white hover:border-zinc-600 hover:bg-zinc-800',
  }[tone];

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`h-8 w-8 inline-flex items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-zinc-500 transition-colors disabled:opacity-50 ${toneClass}`}
    >
      {icon}
    </button>
  );
}

function ResourceLoadingState() {
  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center gap-3 text-sm text-zinc-400 mb-5">
        <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
        Scanning resource manifest...
      </div>
      {Array.from({length: 8}).map((_, index) => (
        <div key={index} className="grid grid-cols-[1fr_120px_120px_160px] gap-4 rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-4">
          <div className="h-4 rounded bg-zinc-800 animate-pulse" />
          <div className="h-4 rounded bg-zinc-800 animate-pulse" />
          <div className="h-4 rounded bg-zinc-800 animate-pulse" />
          <div className="h-4 rounded bg-zinc-800 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ResourceEmptyState({hasQuery}: {hasQuery: boolean}) {
  return (
    <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-center px-6">
      <div className="h-14 w-14 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-4">
        <FolderSearch className="h-7 w-7 text-zinc-600" />
      </div>
      <p className="text-sm font-semibold text-white">
        {hasQuery ? 'No Matching Resources' : 'No Resources Detected'}
      </p>
      <p className="mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
        {hasQuery
          ? 'Try another script name, author, or manifest keyword.'
          : 'Portside is waiting for the server manifest scan to return resources.'}
      </p>
    </div>
  );
}

function ResourceDrawer({resource}: {resource: Resource | null}) {
  if (!resource) {
    return (
      <aside className="hidden xl:flex bg-[#101010] border border-zinc-800 rounded-lg min-h-[520px] items-center justify-center px-8 text-center">
        <div>
          <Info className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm font-semibold text-white">Select a Resource</p>
          <p className="mt-2 text-xs text-zinc-500">Inspect dependencies, latest logs, and manifest metadata.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="bg-[#101010] border border-zinc-800 rounded-lg min-h-[520px] overflow-hidden flex flex-col">
      <div className="p-5 border-b border-zinc-800 bg-zinc-950/70">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge state={resource.state} />
              <span className="font-mono text-[10px] text-zinc-600">{resource.version ? `v${resource.version}` : 'version unknown'}</span>
            </div>
            <h2 className="text-lg font-semibold text-white truncate">{resource.name}</h2>
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              {resource.description || 'No description provided by the resource manifest.'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <DetailSection icon={<Info className="h-4 w-4" />} title="Manifest">
          <div className="grid grid-cols-2 gap-3">
            <DetailMetric label="Author" value={resource.author || 'unassigned'} />
            <DetailMetric label="Version" value={resource.version || 'unknown'} />
          </div>
        </DetailSection>

        <DetailSection icon={<Layers className="h-4 w-4" />} title="Dependencies">
          {resource.dependencies?.length ? (
            <div className="flex flex-wrap gap-2">
              {resource.dependencies.map(dep => (
                <span key={dep} className="px-2 py-1 bg-zinc-950 text-zinc-300 rounded border border-zinc-800 text-[10px] font-mono">
                  {dep}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No dependencies declared.</p>
          )}
        </DetailSection>

        <DetailSection icon={<FileText className="h-4 w-4" />} title="Latest Log">
          <div className="rounded-lg border border-zinc-800 bg-black/40 p-3 font-mono text-xs leading-relaxed text-zinc-400 min-h-[96px]">
            {resource.logs || 'No recent log output for this resource.'}
          </div>
        </DetailSection>
      </div>
    </aside>
  );
}

function DetailSection({icon, title, children}: {icon: React.ReactNode; title: string; children: React.ReactNode}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3">
        <span className="text-orange-500">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function DetailMetric({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold mb-1">{label}</div>
      <div className="font-mono text-xs text-zinc-300 truncate">{value}</div>
    </div>
  );
}

function DangerConfirmModal({
  action,
  resource,
  loading,
  onCancel,
  onConfirm,
}: {
  action: ResourceAction;
  resource: Resource;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = actionCopy[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-lg border border-red-500/20 bg-[#101010] shadow-2xl">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-zinc-800">
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">{copy.title}</h2>
              <p className="mt-1 text-xs text-zinc-500 font-mono">{resource.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="p-1 text-zinc-500 hover:text-white transition-colors disabled:opacity-50"
            aria-label="Close confirmation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm leading-relaxed text-zinc-300">{copy.body}</p>
          <div className="mt-4 rounded border border-zinc-800 bg-black/30 p-3 text-xs text-zinc-500">
            Portside will apply this action immediately and roll back the visible state if the server rejects it.
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-zinc-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {copy.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
