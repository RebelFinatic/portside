import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { AlertTriangle, CheckCircle2, Database, Download, FileCode2, Loader2, PackageOpen, Play, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';

interface CatalogEntry {
  id: string;
  name: string;
  source: string;
  tags: string[];
  description: string | null;
  url: string;
  engine: number | null;
  updatedAt: string;
}

interface RecipeInspection {
  recipeRaw: string;
  metadata: Record<string, unknown>;
  variables: string[];
  taskCount: number;
  tasks: Array<{ index: number; action: string; label: string }>;
  warnings: string[];
}

interface DeployerJob {
  id: string;
  status: string;
  recipeName: string;
  recipeUrl: string | null;
  targetPath: string;
  variables: Record<string, unknown>;
  metadata: Record<string, unknown>;
  validation: { ok?: boolean; checks?: Record<string, boolean> } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  steps?: Array<{ id: string; stepIndex: number; label: string; action: string; status: string; error: string | null }>;
  logs?: Array<{ id: string; timestamp: string; level: string; message: string }>;
}

const defaultVariables: Record<string, string> = {
  serverName: 'Portside Server',
  maxClients: '48',
  serverEndpoints: '0.0.0.0:30120',
  svLicense: '',
  dbHost: 'localhost',
  dbPort: '3306',
  dbUsername: 'root',
  dbPassword: '',
  dbName: 'fivem',
};

const sensitivePattern = /(password|secret|token|license|connection|string|key)/i;

export default function Deployer() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [jobs, setJobs] = useState<DeployerJob[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customText, setCustomText] = useState('');
  const [sourceMode, setSourceMode] = useState<'catalog' | 'custom-url' | 'paste'>('catalog');
  const [targetPath, setTargetPath] = useState('');
  const [query, setQuery] = useState('');
  const [inspection, setInspection] = useState<RecipeInspection | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>(defaultVariables);
  const [activeJob, setActiveJob] = useState<DeployerJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [running, setRunning] = useState(false);

  const selectedRecipe = catalog.find(recipe => recipe.id === selectedId) || null;
  const filteredCatalog = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(recipe => [
      recipe.name,
      recipe.source,
      recipe.description || '',
      recipe.tags.join(' '),
    ].some(value => value.toLowerCase().includes(needle)));
  }, [catalog, query]);

  const load = async () => {
    setLoading(true);
    try {
      const [catalogResponse, jobResponse] = await Promise.all([
        apiFetch('/deployer/catalog'),
        apiFetch('/deployer/jobs'),
      ]);
      setCatalog(catalogResponse.recipes || []);
      setJobs(jobResponse.jobs || []);
      setSelectedId((catalogResponse.recipes || [])[0]?.id || '');
    } catch (error: any) {
      toast.error('Failed to load deployer', { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!activeJob || activeJob.status === 'success' || activeJob.status === 'failed' || activeJob.status === 'cancelled') return;
    const timer = window.setInterval(async () => {
      try {
        setActiveJob(await apiFetch(`/deployer/jobs/${activeJob.id}`));
      } catch {
        window.clearInterval(timer);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeJob]);

  const refreshCatalog = async () => {
    try {
      const response = await apiFetch('/deployer/catalog/refresh', { method: 'POST' });
      setCatalog(response.recipes || []);
      toast.success('Recipe catalog refreshed');
    } catch (error: any) {
      toast.error('Catalog refresh failed', { description: error.message });
      if (Array.isArray(error.recipes)) setCatalog(error.recipes);
    }
  };

  const requestBody = () => {
    if (sourceMode === 'catalog') return { catalogId: selectedId };
    if (sourceMode === 'custom-url') return { url: customUrl };
    return { text: customText };
  };

  const inspect = async () => {
    setInspecting(true);
    try {
      const next = await apiFetch('/deployer/recipes/inspect', {
        method: 'POST',
        body: JSON.stringify(requestBody()),
      });
      setInspection(next);
      const filled = { ...defaultVariables, ...variables };
      next.variables.forEach((name: string) => {
        if (filled[name] === undefined) filled[name] = '';
      });
      setVariables(filled);
      toast.success('Recipe inspected');
    } catch (error: any) {
      toast.error('Recipe inspection failed', { description: error.message });
    } finally {
      setInspecting(false);
    }
  };

  const createAndRun = async () => {
    if (!inspection) return;
    if (!targetPath.trim()) {
      toast.error('Target path is required');
      return;
    }
    const confirmed = window.confirm('Run this recipe now? It can create, overwrite, or remove files inside the selected target folder.');
    if (!confirmed) return;
    setRunning(true);
    try {
      const job = await apiFetch('/deployer/jobs', {
        method: 'POST',
        body: JSON.stringify({ ...requestBody(), targetPath, variables, confirmDestructive: true }),
      });
      setActiveJob(job);
      const completed = await apiFetch(`/deployer/jobs/${job.id}/run`, { method: 'POST' });
      setActiveJob(completed);
      const jobResponse = await apiFetch('/deployer/jobs');
      setJobs(jobResponse.jobs || []);
      toast.success(completed.status === 'success' ? 'Deployment finished' : 'Deployment failed');
    } catch (error: any) {
      toast.error('Deployment failed', { description: error.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 border-b border-zinc-800/50 pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Recipe Deployer</h1>
          <p className="mt-1 text-sm text-zinc-500">Deploy txAdmin-compatible server recipes into a jailed server-data folder.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={refreshCatalog} className="inline-flex items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase text-zinc-200 hover:bg-zinc-800">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Catalog
          </button>
          <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase text-zinc-200 hover:bg-zinc-800">
            <Download className="h-3.5 w-3.5" />
            Reload Jobs
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-zinc-800 bg-[#111] text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading deployer...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <main className="space-y-6">
            <section className="rounded-lg border border-zinc-800 bg-[#111]">
              <PanelHeader icon={<PackageOpen className="h-4 w-4" />} title="Recipe Source" />
              <div className="space-y-4 p-4">
                <div className="flex flex-wrap gap-2">
                  <ModeButton active={sourceMode === 'catalog'} onClick={() => setSourceMode('catalog')}>Catalog</ModeButton>
                  <ModeButton active={sourceMode === 'custom-url'} onClick={() => setSourceMode('custom-url')}>Custom URL</ModeButton>
                  <ModeButton active={sourceMode === 'paste'} onClick={() => setSourceMode('paste')}>Paste YAML</ModeButton>
                </div>

                {sourceMode === 'catalog' && (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search txAdmin, Portside, ND, QBCore..." className="w-full rounded border border-zinc-800 bg-black/30 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500" />
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {filteredCatalog.map(recipe => (
                        <button key={recipe.id} onClick={() => setSelectedId(recipe.id)} className={`min-h-[132px] rounded-lg border p-4 text-left transition-colors ${selectedId === recipe.id ? 'border-orange-500/50 bg-orange-500/10' : 'border-zinc-800 bg-black/20 hover:border-zinc-700'}`}>
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-semibold text-white">{recipe.name}</h3>
                              <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">{recipe.source}</div>
                            </div>
                            {recipe.source === 'portside' ? <span className="rounded border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-[10px] font-bold uppercase text-orange-300">Added</span> : null}
                          </div>
                          <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{recipe.description || 'No description provided.'}</p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {recipe.tags.map(tag => <span key={tag} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] uppercase text-zinc-500">{tag}</span>)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {sourceMode === 'custom-url' && (
                  <Field label="Recipe URL" value={customUrl} onChange={setCustomUrl} placeholder="https://raw.githubusercontent.com/.../recipe.yaml" />
                )}

                {sourceMode === 'paste' && (
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
                    Recipe YAML
                    <textarea value={customText} onChange={(event) => setCustomText(event.target.value)} rows={9} className="mt-2 w-full rounded border border-zinc-800 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-zinc-600 focus:border-orange-500" />
                  </label>
                )}

                <div className="flex justify-end">
                  <button onClick={inspect} disabled={inspecting || (sourceMode === 'catalog' && !selectedId)} className="inline-flex items-center gap-2 rounded bg-orange-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50">
                    {inspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4" />}
                    Inspect Recipe
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-[#111]">
              <PanelHeader icon={<Database className="h-4 w-4" />} title="Variables And Target" />
              <div className="space-y-4 p-4">
                <Field label="Deployment Target Folder" value={targetPath} onChange={setTargetPath} placeholder="C:/FXServer/txData/PortsideRecipe" />
                {inspection ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {inspection.variables.map(name => (
                        <Field key={name} label={name} value={variables[name] || ''} onChange={(value) => setVariables(prev => ({ ...prev, [name]: value }))} type={sensitivePattern.test(name) ? 'password' : 'text'} />
                      ))}
                    </div>
                    {inspection.warnings.map(warning => (
                      <div key={warning} className="flex items-start gap-2 rounded border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {warning}
                      </div>
                    ))}
                    <div className="flex justify-end">
                      <button onClick={createAndRun} disabled={running} className="inline-flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        Run Deployment
                      </button>
                    </div>
                  </>
                ) : (
                  <Empty text="Inspect a recipe to reveal variables and task preview." />
                )}
              </div>
            </section>

            {inspection && (
              <section className="rounded-lg border border-zinc-800 bg-[#111]">
                <PanelHeader icon={<FileCode2 className="h-4 w-4" />} title={`${String(inspection.metadata.name || selectedRecipe?.name || 'Recipe')} Tasks`} />
                <div className="divide-y divide-zinc-900">
                  {inspection.tasks.map(task => (
                    <div key={task.index} className="grid grid-cols-1 gap-2 p-4 text-sm md:grid-cols-[80px_180px_minmax(0,1fr)] md:items-center">
                      <span className="font-mono text-xs text-zinc-600">#{task.index + 1}</span>
                      <span className="font-mono text-xs text-orange-300">{task.action}</span>
                      <span className="truncate text-zinc-300">{task.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </main>

          <aside className="space-y-6">
            <section className="rounded-lg border border-zinc-800 bg-[#111]">
              <PanelHeader icon={<Play className="h-4 w-4" />} title="Active Job" />
              {activeJob ? <JobView job={activeJob} /> : <Empty text="No active deployer job." />}
            </section>

            <section className="rounded-lg border border-zinc-800 bg-[#111]">
              <PanelHeader icon={<CheckCircle2 className="h-4 w-4" />} title="Recent Jobs" />
              <div className="divide-y divide-zinc-900">
                {jobs.length ? jobs.map(job => (
                  <button key={job.id} onClick={async () => setActiveJob(await apiFetch(`/deployer/jobs/${job.id}`))} className="w-full p-4 text-left hover:bg-zinc-950/60">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{job.recipeName}</div>
                        <div className="mt-1 truncate font-mono text-[10px] text-zinc-600">{job.targetPath}</div>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>
                  </button>
                )) : <Empty text="No deployer jobs yet." />}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function PanelHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
      <span className="text-orange-400">{icon}</span>
      {title}
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded border px-3 py-1.5 text-xs font-bold uppercase ${active ? 'border-orange-500/40 bg-orange-500/10 text-orange-300' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'}`}>
      {children}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 w-full rounded border border-zinc-800 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500" />
    </label>
  );
}

function JobView({ job }: { job: DeployerJob }) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{job.recipeName}</div>
          <div className="mt-1 truncate font-mono text-[10px] text-zinc-600">{job.id}</div>
        </div>
        <StatusBadge status={job.status} />
      </div>
      {job.error && <div className="rounded border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">{job.error}</div>}
      {job.validation && (
        <div className="rounded border border-zinc-800 bg-black/20 p-3 text-xs text-zinc-400">
          Validation: {job.validation.ok ? 'passed' : 'failed'}
        </div>
      )}
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {(job.steps || []).map(step => (
          <div key={step.id} className="rounded border border-zinc-800 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs text-zinc-300">{step.label}</span>
              <StatusBadge status={step.status} />
            </div>
            {step.error && <div className="mt-2 text-xs text-red-300">{step.error}</div>}
          </div>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto rounded border border-zinc-800 bg-black/30 p-3 font-mono text-[11px] text-zinc-500">
        {(job.logs || []).map(log => (
          <div key={log.id}><span className="text-zinc-700">{new Date(log.timestamp).toLocaleTimeString()}</span> [{log.level}] {log.message}</div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'success'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    : status === 'failed'
      ? 'border-red-500/20 bg-red-500/10 text-red-300'
      : status === 'running'
        ? 'border-orange-500/20 bg-orange-500/10 text-orange-300'
        : 'border-zinc-800 bg-zinc-950 text-zinc-500';
  return <span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-bold uppercase ${tone}`}>{status}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="p-6 text-center text-sm text-zinc-500">{text}</div>;
}
