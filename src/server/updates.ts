import type { PortsideStore, UpdateReleaseRecord, UpdatesCacheRecord } from './store';

const parseVersion = (version: string) => version.replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);

const compareVersions = (a: string, b: string) => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const normalizeRelease = (release: any): UpdateReleaseRecord => ({
  tagName: typeof release?.tag_name === 'string' ? release.tag_name : '',
  name: typeof release?.name === 'string' && release.name.trim() ? release.name : (typeof release?.tag_name === 'string' ? release.tag_name : 'Untitled release'),
  body: typeof release?.body === 'string' ? release.body : '',
  htmlUrl: typeof release?.html_url === 'string' ? release.html_url : '',
  publishedAt: typeof release?.published_at === 'string' ? release.published_at : null,
  prerelease: Boolean(release?.prerelease),
});

const getLatestVersion = (releases: UpdateReleaseRecord[]) => (
  releases
    .map(release => release.tagName)
    .filter(tag => Boolean(tag))
    .sort((a, b) => compareVersions(b, a))[0] || null
);

export const refreshUpdatesCache = async (store: PortsideStore) => {
  const config = store.getUpdatesConfig();
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/releases`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'portside-updates',
    },
  });
  if (!response.ok) throw new Error(`GitHub releases request failed with ${response.status}`);
  const payload = await response.json();
  const releases = Array.isArray(payload) ? payload.map(normalizeRelease) : [];
  const cache: UpdatesCacheRecord = {
    source: 'github-releases',
    owner: config.owner,
    repo: config.repo,
    latestVersion: getLatestVersion(releases),
    checkedAt: new Date().toISOString(),
    releases,
    fetchError: null,
  };
  store.setUpdatesCache(cache);
  return cache;
};

export const getUpdateStatus = (store: PortsideStore, currentVersion: string) => {
  const config = store.getUpdatesConfig();
  const cache = store.getUpdatesCache();
  const latestVersion = cache?.latestVersion || null;
  const updateAvailable = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
  return {
    source: config.source,
    owner: config.owner,
    repo: config.repo,
    currentVersion,
    latestVersion,
    updateAvailable,
    checkedAt: cache?.checkedAt || null,
    cacheAgeSeconds: cache?.checkedAt ? Math.max(0, Math.round((Date.now() - new Date(cache.checkedAt).getTime()) / 1000)) : null,
    fetchError: cache?.fetchError || null,
  };
};

export const getUpdateChangelog = (store: PortsideStore) => {
  const cache = store.getUpdatesCache();
  return {
    checkedAt: cache?.checkedAt || null,
    releases: cache?.releases || [],
    fetchError: cache?.fetchError || null,
  };
};

export const refreshUpdatesWithFallback = async (store: PortsideStore) => {
  try {
    const cache = await refreshUpdatesCache(store);
    return { cache, stale: false };
  } catch (error: any) {
    const existing = store.getUpdatesCache();
    if (existing) {
      store.setUpdatesCache({
        ...existing,
        fetchError: error.message || 'Failed to refresh updates',
      });
      return { cache: store.getUpdatesCache(), stale: true };
    }
    throw error;
  }
};
