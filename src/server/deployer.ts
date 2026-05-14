import { execFile } from 'child_process';
import crypto from 'crypto';
import { createWriteStream } from 'fs';
import { access, copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { constants } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import mysql from 'mysql2/promise';
import { parse } from 'yaml';
import type { DeployerJobRecord, PortsideStore, RecipeCatalogEntryRecord } from './store';

const execFileAsync = promisify(execFile);

const TXADMIN_CATALOG_URL = 'https://raw.githubusercontent.com/citizenfx/txAdmin-recipes/main/indexv4.json';
export const ND_RECIPE_URL = 'https://raw.githubusercontent.com/ND-Framework/txadmin-recipe/main/nd-main.yaml';

const FALLBACK_CATALOG: Array<Omit<RecipeCatalogEntryRecord, 'updatedAt'>> = [
  {
    id: 'portside-nd-framework',
    name: 'ND Framework',
    source: 'portside',
    tags: ['fivem', 'roleplay'],
    description: 'ND Framework main txAdmin recipe, pinned by Portside.',
    url: ND_RECIPE_URL,
    engine: 3,
  },
  {
    id: 'txadmin-fivem-basic-server-cfx-default',
    name: 'FiveM Basic Server (CFX Default)',
    source: 'txadmin',
    tags: ['fivem'],
    description: 'A minimal server, without framework, with just the config required to run a FiveM server.',
    url: 'https://raw.githubusercontent.com/citizenfx/txAdmin-recipes/refs/heads/main/default-fivem/recipe.yaml',
    engine: 3,
  },
  {
    id: 'txadmin-esx-legacy',
    name: 'ESX Legacy',
    source: 'txadmin',
    tags: ['fivem', 'roleplay'],
    description: 'The official recipe of the most popular FiveM RP framework.',
    url: 'https://raw.githubusercontent.com/esx-framework/ESX-recipes/legacy/recipe.yaml',
    engine: 3,
  },
  {
    id: 'txadmin-qbox',
    name: 'Qbox',
    source: 'txadmin',
    tags: ['fivem', 'roleplay'],
    description: 'Modern FiveM framework compatible with QBCore resources.',
    url: 'https://raw.githubusercontent.com/Qbox-project/txAdminRecipe/refs/heads/main/qbox.yaml',
    engine: 3,
  },
  {
    id: 'txadmin-qbcore',
    name: 'QBCore',
    source: 'txadmin',
    tags: ['fivem', 'roleplay'],
    description: 'An advanced FiveM RP framework including jobs, gangs, housing and more.',
    url: 'https://raw.githubusercontent.com/qbcore-framework/txAdminRecipe/main/qbcore.yaml',
    engine: 3,
  },
  {
    id: 'txadmin-redm-basic-server-cfx-default',
    name: 'RedM Basic Server (CFX Default)',
    source: 'txadmin',
    tags: ['redm'],
    description: 'A minimal server, without framework, with just the config required to run a RedM server.',
    url: 'https://raw.githubusercontent.com/citizenfx/txAdmin-recipes/refs/heads/main/default-redm/recipe.yaml',
    engine: 3,
  },
  {
    id: 'txadmin-vorp-core',
    name: 'VORP Core',
    source: 'txadmin',
    tags: ['redm', 'roleplay'],
    description: 'Leading RP Framework for RedM.',
    url: 'https://raw.githubusercontent.com/VORPCORE/VORP_txAdmin/main/vorp_recipe.yaml',
    engine: 3,
  },
];

const secretKeyPattern = /(password|secret|token|license|connection|string|key)/i;

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const redactValue = (key: string, value: unknown): unknown => {
  if (secretKeyPattern.test(key) && value) return `[redacted:${String(value).length}]`;
  if (Array.isArray(value)) return value.map((item, index) => redactValue(`${key}.${index}`, item));
  if (value && typeof value === 'object') return redactRecord(value as Record<string, unknown>);
  return value;
};

export const redactRecord = (input: Record<string, unknown>) => Object.fromEntries(
  Object.entries(input || {}).map(([key, value]) => [key, redactValue(key, value)])
);

const normalizeCatalogEntry = (entry: any, source: 'txadmin' | 'portside'): Omit<RecipeCatalogEntryRecord, 'updatedAt'> | null => {
  if (!entry || typeof entry.name !== 'string' || typeof entry.url !== 'string') return null;
  return {
    id: `${source}-${slugify(entry.name) || crypto.createHash('sha1').update(entry.url).digest('hex').slice(0, 10)}`,
    name: entry.name,
    source,
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag: unknown) => typeof tag === 'string') : [],
    description: typeof entry.description === 'string' ? entry.description : null,
    url: entry.url,
    engine: Number.isFinite(Number(entry.engine)) ? Number(entry.engine) : null,
  };
};

export const ensureRecipeCatalog = async (store: PortsideStore) => {
  const existing = store.listRecipeCatalog();
  if (existing.length > 0) return existing;
  store.upsertRecipeCatalog(FALLBACK_CATALOG);
  return store.listRecipeCatalog();
};

export const refreshRecipeCatalog = async (store: PortsideStore) => {
  const response = await fetch(TXADMIN_CATALOG_URL);
  if (!response.ok) throw new Error(`txAdmin catalog returned HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  const remote = Array.isArray(payload)
    ? payload.map(entry => normalizeCatalogEntry(entry, 'txadmin')).filter(Boolean) as Array<Omit<RecipeCatalogEntryRecord, 'updatedAt'>>
    : [];
  if (!remote.length) throw new Error('txAdmin catalog did not contain any recipes');
  const ndEntry = FALLBACK_CATALOG.find(entry => entry.id === 'portside-nd-framework')!;
  return store.upsertRecipeCatalog([ndEntry, ...remote]);
};

const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch recipe: HTTP ${response.status}`);
  return response.text();
};

const interpolate = (value: string, variables: Record<string, unknown>) => (
  value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => String(variables[key] ?? ''))
);

const interpolateDeep = (value: unknown, variables: Record<string, unknown>): unknown => {
  if (typeof value === 'string') return interpolate(value, variables);
  if (Array.isArray(value)) return value.map(item => interpolateDeep(item, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolateDeep(item, variables)]));
  }
  return value;
};

const asString = (value: unknown) => typeof value === 'string' ? value : '';

interface RecipeTask {
  index: number;
  action: string;
  label: string;
  raw: Record<string, unknown>;
}

const extractTasks = (recipe: any): RecipeTask[] => {
  const tasks = Array.isArray(recipe?.tasks) ? recipe.tasks : [];
  return tasks.map((task: any, index: number) => {
    const action = asString(task?.action || task?.type || Object.keys(task || {})[0] || 'unknown');
    return {
      index,
      action,
      label: asString(task?.name || task?.title || task?.label) || `${action} #${index + 1}`,
      raw: task || {},
    };
  });
};

const metadataFromRecipe = (recipe: any, recipeUrl: string | null) => ({
  engine: Number(recipe?.$engine || recipe?.engine || 0) || null,
  minFxVersion: recipe?.$minFxVersion || null,
  onesync: recipe?.$onesync || null,
  name: asString(recipe?.name) || 'Custom recipe',
  version: recipe?.version || null,
  author: recipe?.author || null,
  description: recipe?.description || null,
  recipeUrl,
});

const variablesFromRaw = (raw: string) => {
  const found = new Set<string>();
  for (const match of raw.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) found.add(match[1]);
  return [...found].sort();
};

export const inspectRecipe = async (input: {
  store: PortsideStore;
  catalogId?: string;
  url?: string;
  text?: string;
}) => {
  let recipeUrl = input.url || null;
  if (input.catalogId) {
    const entry = input.store.getRecipeCatalogEntry(input.catalogId);
    if (!entry) throw new Error('Recipe catalog entry not found');
    recipeUrl = entry.url;
  }
  const raw = input.text || (recipeUrl ? await fetchText(recipeUrl) : '');
  if (!raw.trim()) throw new Error('Recipe YAML is required');
  const parsed = parse(raw);
  const tasks = extractTasks(parsed);
  return {
    recipeRaw: raw,
    metadata: metadataFromRecipe(parsed, recipeUrl),
    variables: variablesFromRaw(raw),
    taskCount: tasks.length,
    tasks: tasks.map(task => ({ index: task.index, action: task.action, label: task.label })),
    warnings: tasks.some(task => task.action === 'remove_path') ? ['Recipe contains remove_path tasks. Review destructive actions before running.'] : [],
  };
};

const resolveJailedPath = async (root: string, candidate: unknown) => {
  const base = path.resolve(root);
  const requested = asString(candidate).replace(/^\/+|^\\+/, '');
  const resolved = path.resolve(base, requested || '.');
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside deployment target: ${requested || '.'}`);
  }
  return resolved;
};

const assertSafeTarget = (targetPath: string) => {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) throw new Error('Deployment target cannot be a drive or filesystem root');
  const workspace = path.resolve(process.cwd());
  if (!path.relative(workspace, resolved).startsWith('..')) throw new Error('Deployment target cannot be inside the Portside app folder');
  if (resolved.length < 6) throw new Error('Deployment target path is too short');
  return resolved;
};

const downloadToFile = async (url: string, filePath: string) => {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
  await mkdir(path.dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath);
  await new Promise<void>((resolve, reject) => {
    response.body!.pipeTo(new WritableStream({
      write(chunk) {
        stream.write(Buffer.from(chunk));
      },
      close() {
        stream.end(resolve);
      },
      abort(reason) {
        stream.destroy(reason);
        reject(reason);
      },
    })).catch(reject);
  });
};

const unzipArchive = async (archive: string, destination: string) => {
  await mkdir(destination, { recursive: true });
  if (process.platform === 'win32') {
    await execFileAsync('powershell', ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', archive, '-DestinationPath', destination, '-Force']);
    return;
  }
  await execFileAsync('unzip', ['-o', archive, '-d', destination]);
};

const runDatabaseAction = async (task: Record<string, unknown>, variables: Record<string, unknown>, query?: string) => {
  const uri = asString(task.connection || task.connectionString || variables.dbConnectionString);
  const connection = uri
    ? await mysql.createConnection(uri)
    : await mysql.createConnection({
      host: asString(task.host || variables.dbHost) || 'localhost',
      port: Number(task.port || variables.dbPort || 3306),
      user: asString(task.user || task.username || variables.dbUsername),
      password: asString(task.password || variables.dbPassword),
      database: asString(task.database || variables.dbName),
      multipleStatements: true,
    });
  try {
    if (query) await connection.query(query);
  } finally {
    await connection.end();
  }
};

export const serializeJob = (store: PortsideStore, job: DeployerJobRecord) => ({
  ...job,
  variables: redactRecord(job.variables),
  recipeRaw: undefined,
  steps: store.listDeployerSteps(job.id),
  logs: store.listDeployerLogs(job.id).map(log => ({ ...log, message: log.message.replace(/(password|token|secret|license|key)=\S+/ig, '$1=[redacted]') })),
});

export const runDeployerJob = async (store: PortsideStore, jobId: string) => {
  const job = store.getDeployerJob(jobId, { includeSecrets: true });
  if (!job) throw new Error('Deployer job not found');
  if (job.status !== 'pending' && job.status !== 'failed') throw new Error(`Job is ${job.status}`);

  const targetPath = assertSafeTarget(job.targetPath);
  const recipe = parse(job.recipeRaw);
  const tasks = extractTasks(recipe);
  const variables = job.variables || {};
  await mkdir(targetPath, { recursive: true });
  store.updateDeployerJob(job.id, { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: null });
  store.addDeployerLog(job.id, 'INFO', `Started deployer job for ${job.recipeName}`);

  try {
    for (const task of tasks) {
      const interpolated = interpolateDeep(task.raw, variables) as Record<string, unknown>;
      const stepId = store.createDeployerStep({ jobId: job.id, stepIndex: task.index, action: task.action, label: task.label });
      store.updateDeployerStep(stepId, { status: 'running', startedAt: new Date().toISOString() });
      store.addDeployerLog(job.id, 'INFO', `Running ${task.label}`);
      try {
        await runTask(targetPath, task.action, interpolated, variables, Boolean(job.metadata.confirmDestructive));
        store.updateDeployerStep(stepId, { status: 'success', finishedAt: new Date().toISOString() });
      } catch (error: any) {
        store.updateDeployerStep(stepId, { status: 'failed', finishedAt: new Date().toISOString(), error: error.message });
        throw error;
      }
    }
    const validation = await validateDeployment(targetPath);
    store.updateDeployerJob(job.id, { status: validation.ok ? 'success' : 'failed', validation, finishedAt: new Date().toISOString(), error: validation.ok ? null : 'Deployment validation failed' });
    store.addDeployerLog(job.id, validation.ok ? 'INFO' : 'ERROR', validation.ok ? 'Deployment validation passed' : 'Deployment validation failed');
  } catch (error: any) {
    store.updateDeployerJob(job.id, { status: 'failed', finishedAt: new Date().toISOString(), error: error.message });
    store.addDeployerLog(job.id, 'ERROR', error.message);
  }
  return store.getDeployerJob(job.id)!;
};

const normalizeGithubRepo = (value: string) => value
  .replace(/^https:\/\/github\.com\//i, '')
  .replace(/^git@github\.com:/i, '')
  .replace(/\.git$/i, '')
  .replace(/\/$/, '');

const runTask = async (targetPath: string, action: string, task: Record<string, unknown>, variables: Record<string, unknown>, allowDestructive: boolean) => {
  const file = task.file ?? task.path ?? task.dest ?? task.destination;
  if (action === 'ensure_dir') {
    await mkdir(await resolveJailedPath(targetPath, file), { recursive: true });
    return;
  }
  if (action === 'write_file') {
    const target = await resolveJailedPath(targetPath, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, asString(task.content), 'utf8');
    return;
  }
  if (action === 'replace_string') {
    const target = await resolveJailedPath(targetPath, file);
    const content = await readFile(target, 'utf8');
    await writeFile(target, content.split(asString(task.search)).join(asString(task.replace)), 'utf8');
    return;
  }
  if (action === 'copy_path') {
    const source = await resolveJailedPath(targetPath, task.src ?? task.source);
    const target = await resolveJailedPath(targetPath, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    return;
  }
  if (action === 'move_path') {
    const source = await resolveJailedPath(targetPath, task.src ?? task.source);
    const target = await resolveJailedPath(targetPath, file);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
    return;
  }
  if (action === 'remove_path') {
    if (!allowDestructive) throw new Error('remove_path requires destructive confirmation');
    await rm(await resolveJailedPath(targetPath, file), { recursive: true, force: true });
    return;
  }
  if (action === 'download_file') {
    await downloadToFile(asString(task.url), await resolveJailedPath(targetPath, file));
    return;
  }
  if (action === 'download_github') {
    const repo = normalizeGithubRepo(asString(task.src || task.repo || task.repository));
    const ref = asString(task.ref || task.reference) || 'main';
    const dest = await resolveJailedPath(targetPath, file || '.');
    const tempRoot = path.join(os.tmpdir(), `portside-recipe-${crypto.randomUUID()}`);
    const archive = path.join(tempRoot, 'source.zip');
    const extractPath = path.join(tempRoot, 'extract');
    const url = asString(task.url) || `https://github.com/${repo}/archive/${ref}.zip`;
    await mkdir(tempRoot, { recursive: true });
    try {
      await downloadToFile(url, archive);
      await unzipArchive(archive, extractPath);
      const entries = await readdir(extractPath);
      const sourceRoot = path.join(extractPath, entries[0] || '');
      const source = path.join(sourceRoot, asString(task.subpath || ''));
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(source, dest, { recursive: true, force: true });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
    return;
  }
  if (action === 'unzip') {
    await unzipArchive(await resolveJailedPath(targetPath, task.src ?? task.source), await resolveJailedPath(targetPath, file || '.'));
    return;
  }
  if (action === 'connect_database') {
    await runDatabaseAction(task, variables);
    return;
  }
  if (action === 'query_database') {
    await runDatabaseAction(task, variables, asString(task.query || task.fileContent));
    return;
  }
  if (action === 'load_vars') return;
  if (action === 'waste_time') {
    await new Promise(resolve => setTimeout(resolve, Math.min(Number(task.seconds || 1), 10) * 1000));
    return;
  }
  throw new Error(`Unsupported recipe action: ${action}`);
};

const validateDeployment = async (targetPath: string) => {
  const serverCfg = path.join(targetPath, 'server.cfg');
  const resources = path.join(targetPath, 'resources');
  const checks = {
    serverCfg: await pathExists(serverCfg),
    resources: await pathExists(resources),
  };
  return {
    ok: checks.serverCfg && checks.resources,
    checks,
    targetPath,
  };
};

const pathExists = async (filePath: string) => {
  try {
    await access(filePath, constants.F_OK);
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

export const defaultTargetPath = () => path.join(os.homedir(), 'portside-deployments', `server-${Date.now()}`);
