import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import type { Pool } from 'mysql2/promise';
import type { DiscordStatusService } from './discord';
import type { FxServerManager } from './fxserver';
import type { MemoryLogger } from './logging';
import { sampleRuntimeMetrics } from './metrics';
import { MONITOR_VERSION } from './monitor';
import type { PortsideStore } from './store';

const SECRET_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /rcon/i,
  /license/i,
  /cfx/i,
  /key/i,
  /jwt/i,
];

const CONFIG_KEYS = [
  'PORTSIDE_DATA_PATH',
  'JWT_SECRET',
  'PORTSIDE_PORT',
  'PORTSIDE_HOST_API_TOKEN',
  'TXHOST_API_TOKEN',
  'PORTSIDE_LOG_RETENTION_DAYS',
  'PORTSIDE_FXSERVER_MODE',
  'PORTSIDE_FXSERVER_BINARY',
  'PORTSIDE_FXSERVER_CWD',
  'PORTSIDE_FXSERVER_ARGS',
  'PORTSIDE_FXSERVER_RESTART_ON_CRASH',
  'PORTSIDE_FXSERVER_STOP_TIMEOUT_MS',
  'FIVEM_SERVER_URL',
  'FIVEM_SERVER_CFG_PATH',
  'FIVEM_RCON_PASSWORD',
  'FIVEM_RCON_HOST',
  'FIVEM_RCON_PORT',
  'FIVEM_RCON_BAN_COMMAND',
  'PORTSIDE_MONITOR_TOKEN',
  'PORTSIDE_MONITOR_COMPAT_TXADMIN_COMMANDS',
  'PORTSIDE_WHITELIST_MODE',
  'PORTSIDE_DISCORD_BOT_TOKEN',
  'PORTSIDE_DISCORD_GUILD_ID',
  'PORTSIDE_DISCORD_STATUS_CHANNEL_ID',
  'PORTSIDE_DISCORD_STATUS_MESSAGE_ID',
  'PORTSIDE_DISCORD_STATUS_INTERVAL_SECONDS',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'PORTSIDE_DEFAULT_CFX_KEY',
  'TXHOST_DEFAULT_CFXKEY',
  'DEBUG',
  'VITE_DEBUG',
];

const dataPath = () => path.resolve(process.env.PORTSIDE_DATA_PATH || '.portside');
const logPath = () => path.join(dataPath(), 'logs');

const readPackageVersion = () => {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
};

const readGitCommit = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

const filesystemHealth = (target: string) => {
  try {
    if (!existsSync(target)) mkdirSync(target, { recursive: true });
    const stats = statSync(target);
    accessSync(target, constants.R_OK | constants.W_OK);
    return {
      path: target,
      exists: true,
      readable: true,
      writable: true,
      isDirectory: stats.isDirectory(),
      updatedAt: stats.mtime.toISOString(),
      error: null,
    };
  } catch (error: any) {
    return {
      path: target,
      exists: existsSync(target),
      readable: false,
      writable: false,
      isDirectory: false,
      updatedAt: null,
      error: error.message,
    };
  }
};

const isSecretKey = (key: string) => SECRET_PATTERNS.some(pattern => pattern.test(key));
const containsSecretMaterial = (value: string | undefined) => Boolean(value && /(?:sv_licenseKey|licenseKey|password|token|secret|apikey|api_key)/i.test(value));

const redactConfig = () => CONFIG_KEYS.map(key => {
  const value = process.env[key];
  if (isSecretKey(key) || containsSecretMaterial(value)) {
    return {
      key,
      configured: Boolean(value),
      value: value ? '<redacted>' : '',
      length: value?.length || 0,
      secret: true,
    };
  }

  return {
    key,
    configured: value !== undefined && value !== '',
    value: value || '',
    length: value?.length || 0,
    secret: false,
  };
});

const checkDatabase = async (dbPool: Pool | null) => {
  if (!process.env.DB_HOST || !process.env.DB_USER) {
    return { mode: 'mock', configured: false, connected: false, error: null };
  }

  if (!dbPool) {
    return { mode: 'configured', configured: true, connected: false, error: 'Pool was not created' };
  }

  try {
    const connection = await dbPool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
    return { mode: 'configured', configured: true, connected: true, error: null };
  } catch (error: any) {
    return { mode: 'configured', configured: true, connected: false, error: error.message };
  }
};

export const collectDiagnostics = async (input: {
  store: PortsideStore;
  logger: MemoryLogger;
  fxServer: FxServerManager;
  discordStatus?: DiscordStatusService;
  dbPool: Pool | null;
}) => {
  const metrics = sampleRuntimeMetrics();
  const monitor = input.store.getMonitorStatus();
  const fxserver = input.fxServer.getStatus();
  const discord = input.discordStatus?.getStatus() || {
    configured: false,
    enabled: false,
    connected: false,
    lastUpdateAt: null,
    lastError: null,
  };

  return {
    generatedAt: new Date().toISOString(),
    portside: {
      version: readPackageVersion(),
      monitorVersion: MONITOR_VERSION,
      commit: readGitCommit(),
      node: process.version,
      pid: process.pid,
      cwd: process.cwd(),
      uptimeSeconds: metrics.process.uptimeSeconds,
      uptime: metrics.process.uptime,
      memoryBytes: metrics.process.memoryBytes,
      heapUsedBytes: metrics.process.heapUsedBytes,
    },
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpuCount: metrics.host.cpuCount,
      totalMemoryBytes: metrics.host.totalMemoryBytes,
      freeMemoryBytes: metrics.host.freeMemoryBytes,
      uptimeSeconds: metrics.host.uptimeSeconds,
      uptime: metrics.host.uptime,
      loadAverage: metrics.host.loadAverage,
    },
    filesystem: {
      dataPath: filesystemHealth(dataPath()),
      logPath: filesystemHealth(logPath()),
    },
    fxserver,
    monitor,
    discord,
    database: await checkDatabase(input.dbPool),
    hostStatus: {
      tokenConfigured: Boolean(process.env.PORTSIDE_HOST_API_TOKEN || process.env.TXHOST_API_TOKEN),
      compatibilityAliasConfigured: Boolean(process.env.TXHOST_API_TOKEN),
    },
    config: redactConfig(),
  };
};

export const collectDiagnosticsBundle = async (input: {
  store: PortsideStore;
  logger: MemoryLogger;
  fxServer: FxServerManager;
  discordStatus?: DiscordStatusService;
  dbPool: Pool | null;
}) => {
  const diagnostics = await collectDiagnostics(input);
  const errorLogs = input.logger
    .search({ limit: 500 })
    .filter(log => log.level === 'ERROR' || log.level === 'WARN')
    .slice(0, 100);
  const adminEvents = input.store
    .recentActionLogs(100)
    .filter((log: any) => log.status === 'denied' || log.status === 'failed')
    .slice(0, 50);

  return {
    ...diagnostics,
    logs: {
      recentErrors: errorLogs,
      recentAdminFailures: adminEvents,
    },
  };
};
