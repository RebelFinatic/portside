import { useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';

interface UpdateStatus {
  source: string;
  owner: string;
  repo: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  cacheAgeSeconds: number | null;
  fetchError: string | null;
  stale?: boolean;
}

interface UpdateRelease {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
}

interface ChangelogPayload {
  checkedAt: string | null;
  releases: UpdateRelease[];
  fetchError: string | null;
}

export default function Updates() {
  const hasSettingsWrite = useAuthStore(state => state.hasPermission('settings.write'));
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [changelog, setChangelog] = useState<ChangelogPayload | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [nextStatus, nextChangelog] = await Promise.all([
        apiFetch('/updates/status'),
        apiFetch('/updates/changelog'),
      ]);
      setStatus(nextStatus);
      setChangelog(nextChangelog);
    } catch (error: any) {
      toast.error('Failed to load updates', { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const checkNow = async () => {
    if (!hasSettingsWrite) return;
    setChecking(true);
    try {
      const nextStatus = await apiFetch('/updates/check', { method: 'POST' });
      setStatus(nextStatus);
      const nextChangelog = await apiFetch('/updates/changelog');
      setChangelog(nextChangelog);
      toast.success(nextStatus.stale ? 'Update check used cached data' : 'Update check completed');
    } catch (error: any) {
      toast.error('Update check failed', { description: error.message });
    } finally {
      setChecking(false);
    }
  };

  const latestSummary = useMemo(() => {
    if (!status) return 'Unknown';
    if (!status.latestVersion) return 'No release data yet';
    return status.updateAvailable
      ? `Update available: ${status.latestVersion}`
      : `Up to date (${status.currentVersion})`;
  }, [status]);

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 border-b border-zinc-800/50 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Updates</h1>
          <p className="text-sm text-zinc-500">Check latest releases and changelog metadata from the configured GitHub source.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
          <button
            onClick={checkNow}
            disabled={!hasSettingsWrite || checking}
            className="inline-flex items-center gap-2 rounded border border-orange-600/40 bg-orange-600/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-orange-300 hover:bg-orange-600/20 disabled:opacity-60"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
            Check Now
          </button>
        </div>
      </div>

      {loading && !status && (
        <div className="rounded-lg border border-zinc-800 bg-[#111] p-6 text-zinc-400">Loading update status...</div>
      )}

      {status && (
        <div className="space-y-5">
          <section className="rounded-lg border border-zinc-800 bg-[#111] p-5">
            <div className="mb-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Status</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Metric label="Current" value={status.currentVersion} />
              <Metric label="Latest" value={status.latestVersion || 'Unknown'} />
              <Metric label="Source" value={`${status.owner}/${status.repo}`} />
              <Metric label="Checked" value={status.checkedAt ? new Date(status.checkedAt).toLocaleString() : 'Never'} />
            </div>
            <p className={`mt-4 text-sm ${status.updateAvailable ? 'text-orange-300' : 'text-emerald-300'}`}>{latestSummary}</p>
            {status.fetchError && <p className="mt-2 text-xs text-red-400">Last fetch issue: {status.fetchError}</p>}
          </section>

          <section className="rounded-lg border border-zinc-800 bg-[#111]">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Recent Changelog</h2>
            </div>
            <div className="divide-y divide-zinc-900">
              {(changelog?.releases || []).slice(0, 12).map(release => (
                <article key={`${release.tagName}-${release.publishedAt || release.name}`} className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{release.name}</div>
                    <div className="text-xs text-zinc-500">{release.publishedAt ? new Date(release.publishedAt).toLocaleString() : 'Unknown date'}</div>
                  </div>
                  <div className="mb-2 text-xs text-zinc-400">{release.tagName}{release.prerelease ? ' (pre-release)' : ''}</div>
                  {release.htmlUrl && (
                    <a className="text-xs text-orange-400 hover:text-orange-300" href={release.htmlUrl} target="_blank" rel="noreferrer">
                      Open release notes
                    </a>
                  )}
                </article>
              ))}
              {!changelog?.releases?.length && (
                <div className="p-4 text-sm text-zinc-500">No changelog entries cached yet. Use Check Now to fetch releases.</div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-black/20 p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
