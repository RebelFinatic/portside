import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import crypto from 'crypto';
import { ALL_PERMISSIONS, normalizePermissions } from './permissions';
import { cleanIdentifierList, listsOverlap, parseDurationToExpiration } from './moderation';

const now = () => new Date().toISOString();

const normalizeWarningMinutes = (minutes: unknown = [30, 15, 10, 5, 4, 3, 2, 1]) => {
  const values = Array.isArray(minutes) ? minutes : [30, 15, 10, 5, 4, 3, 2, 1];
  return [...new Set(values.map(Number).filter(value => Number.isFinite(value) && value > 0 && value <= 1440))]
    .sort((a, b) => b - a);
};

const normalizeDaysOfWeek = (days: unknown = [0, 1, 2, 3, 4, 5, 6]) => {
  const values = Array.isArray(days) ? days : [0, 1, 2, 3, 4, 5, 6];
  const normalized = [...new Set(values.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [0, 1, 2, 3, 4, 5, 6];
};

const secretKeyPattern = /(password|secret|token|license|connection|string|key)/i;

const redactRecord = (input: Record<string, unknown>) => Object.fromEntries(
  Object.entries(input || {}).map(([key, value]) => [
    key,
    secretKeyPattern.test(key) && value ? `[redacted:${String(value).length}]` : value,
  ])
);

export interface RoleRecord {
  id: string;
  name: string;
  permissions: string[];
  isOwner: boolean;
}

export interface AdminRecord {
  id: string;
  username: string;
  roleId: string;
  role: string;
  permissions: string[];
  identifiers: string[];
  enabled: boolean;
  isOwner: boolean;
}

export interface SessionRecord {
  id: string;
  adminId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AdminProviderIdentityRecord {
  id: string;
  adminId: string;
  adminUsername: string;
  provider: 'cfx';
  providerUserId: string;
  displayName: string;
  identifiers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProviderAuthStateRecord {
  id: string;
  provider: 'cfx';
  mode: 'login' | 'link';
  nonce: string;
  actorAdminId: string | null;
  targetAdminId: string | null;
  returnTo: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface MonitorHeartbeatRecord {
  id: string;
  timestamp: string;
  resourceName: string;
  version: string | null;
  gameName: string | null;
  serverName: string | null;
  players: number | null;
  maxPlayers: number | null;
  debug: boolean;
}

export interface MonitorResourceRecord {
  name: string;
  state: string;
  path: string | null;
  author: string | null;
  version: string | null;
  description: string | null;
  dependencies: string[];
  metadata: Record<string, unknown> | null;
  updatedAt: string;
}

export interface MonitorPlayerRecord {
  id: number;
  name: string;
  ping: number;
  identifiers: string[];
  hwids: string[];
  endpoint: string | null;
  updatedAt: string;
}

export interface PlayerRecord {
  id: string;
  displayName: string;
  recentNames: string[];
  identifiers: string[];
  hwids: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  lastSource: number | null;
}

export interface RestartScheduleRecord {
  id: string;
  name: string;
  enabled: boolean;
  type: 'daily' | 'temporary';
  timeOfDay: string | null;
  executeAt: string | null;
  daysOfWeek: number[];
  warningMinutes: number[];
  message: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WhitelistMode = 'disabled' | 'dry-run' | 'enforced';
export type WhitelistEntryType = 'identifier' | 'discord' | 'player';
export type WhitelistRequestStatus = 'pending' | 'approved' | 'rejected';

export interface WhitelistEntryRecord {
  id: string;
  type: WhitelistEntryType;
  value: string;
  playerId: string | null;
  discordId: string | null;
  note: string | null;
  createdAt: string;
  createdByUsername: string | null;
}

export interface WhitelistRequestRecord {
  id: string;
  status: WhitelistRequestStatus;
  playerName: string;
  identifiers: string[];
  hwids: string[];
  discordId: string | null;
  reason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByUsername: string | null;
  reviewReason: string | null;
}

export interface DiscordStatusSettingsRecord {
  enabled: boolean;
  guildId: string | null;
  statusChannelId: string | null;
  statusMessageId: string | null;
  updateIntervalSeconds: number;
  updatedAt: string;
}

export interface AppSettingRecord {
  key: string;
  value: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface UpdateReleaseRecord {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
}

export interface UpdatesConfigRecord {
  source: 'github-releases';
  owner: string;
  repo: string;
}

export interface UpdatesCacheRecord {
  source: 'github-releases';
  owner: string;
  repo: string;
  latestVersion: string | null;
  checkedAt: string;
  releases: UpdateReleaseRecord[];
  fetchError: string | null;
}

export interface RecipeCatalogEntryRecord {
  id: string;
  name: string;
  source: string;
  tags: string[];
  description: string | null;
  url: string;
  engine: number | null;
  updatedAt: string;
}

export interface DeployerJobRecord {
  id: string;
  status: string;
  planId: string | null;
  recipeName: string;
  recipeUrl: string | null;
  targetPath: string;
  variables: Record<string, unknown>;
  recipeRaw: string;
  metadata: Record<string, unknown>;
  validation: Record<string, unknown> | null;
  resumeFromStep: number | null;
  confirmationHash: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface DeployerStepRecord {
  id: string;
  jobId: string;
  stepIndex: number;
  label: string;
  action: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface DeployerLogRecord {
  id: string;
  jobId: string;
  timestamp: string;
  level: string;
  message: string;
}

export type OnboardingMilestone =
  | 'account_created'
  | 'environment_checked'
  | 'recipe_selected'
  | 'variables_completed'
  | 'deployment_planned'
  | 'deployment_applied'
  | 'go_live_ready';

export type OnboardingDeploymentSource = 'catalog' | 'existing-data' | 'remote-url' | 'custom-yaml';

export interface OnboardingStateRecord {
  adminId: string;
  completed: boolean;
  skipped: boolean;
  milestone: OnboardingMilestone;
  deploymentSource: OnboardingDeploymentSource | null;
  attachedTargetPath: string | null;
  defaultTargetPath: string | null;
  milestones: Record<OnboardingMilestone, string | null>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  skippedAt: string | null;
}

export interface DeployerPlanRecord {
  id: string;
  status: 'draft' | 'planned' | 'ready' | 'applied' | 'failed' | 'cancelled';
  recipeName: string;
  recipeUrl: string | null;
  targetPath: string;
  variables: Record<string, unknown>;
  recipeRaw: string;
  metadata: Record<string, unknown>;
  warnings: string[];
  impactSummary: Record<string, unknown>;
  checks: Record<string, unknown>;
  confirmationTokenHash: string;
  createdByAdminId: string | null;
  createdByUsername: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
}

export interface DeployerPlanStepRecord {
  id: string;
  planId: string;
  stepIndex: number;
  label: string;
  action: string;
  impact: string;
  target: string | null;
  isDestructive: boolean;
  details: Record<string, unknown> | null;
}

export class PortsideStore {
  readonly db: Database.Database;

  constructor() {
    const dataPath = path.resolve(process.env.PORTSIDE_DATA_PATH || '.portside');
    mkdirSync(dataPath, { recursive: true });
    this.db = new Database(path.join(dataPath, 'portside.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        is_owner INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        PRIMARY KEY (role_id, permission),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_owner INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (role_id) REFERENCES roles(id)
      );

      CREATE TABLE IF NOT EXISTS admin_identifiers (
        admin_id TEXT NOT NULL,
        identifier TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (admin_id, identifier),
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS admin_provider_identities (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        identifiers TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, provider_user_id),
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provider_auth_states (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        mode TEXT NOT NULL,
        nonce TEXT NOT NULL,
        actor_admin_id TEXT,
        target_admin_id TEXT,
        return_to TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS admin_action_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        actor_admin_id TEXT,
        actor_username TEXT,
        action TEXT NOT NULL,
        method TEXT,
        route TEXT,
        permission TEXT,
        status TEXT NOT NULL,
        ip TEXT,
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS auth_attempts (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        username TEXT,
        ip TEXT,
        success INTEGER NOT NULL,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS console_command_history (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        admin_id TEXT,
        username TEXT,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        output TEXT
      );

      CREATE TABLE IF NOT EXISTS monitor_heartbeat (
        id TEXT PRIMARY KEY CHECK (id = 'current'),
        timestamp TEXT NOT NULL,
        resource_name TEXT NOT NULL,
        version TEXT,
        game_name TEXT,
        server_name TEXT,
        players INTEGER,
        max_players INTEGER,
        debug INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS monitor_resources (
        name TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        path TEXT,
        author TEXT,
        version TEXT,
        description TEXT,
        dependencies TEXT,
        metadata TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS monitor_players (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        ping INTEGER NOT NULL DEFAULT 0,
        identifiers TEXT,
        hwids TEXT,
        endpoint TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS monitor_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        event_name TEXT NOT NULL,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT
      );

      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        recent_names TEXT,
        identifiers TEXT,
        hwids TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_source INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_sessions (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        source_id INTEGER,
        joined_at TEXT NOT NULL,
        left_at TEXT,
        drop_reason TEXT,
        identifiers TEXT,
        hwids TEXT,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS moderation_actions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        player_id TEXT,
        target_name TEXT,
        target_identifiers TEXT,
        target_hwids TEXT,
        reason TEXT,
        duration_input TEXT,
        expires_at TEXT,
        author_admin_id TEXT,
        author_username TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by_admin_id TEXT,
        revoked_by_username TEXT,
        revocation_reason TEXT,
        acknowledged_at TEXT,
        acknowledged_by_source INTEGER,
        acknowledgement_metadata TEXT,
        metadata TEXT,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS player_notes (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        note TEXT NOT NULL,
        author_admin_id TEXT,
        author_username TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ban_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        duration TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS restart_schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        type TEXT NOT NULL DEFAULT 'daily',
        time_of_day TEXT,
        execute_at TEXT,
        warning_minutes TEXT,
        message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS restart_skips (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        occurrence_at TEXT NOT NULL,
        temporary INTEGER NOT NULL DEFAULT 1,
        author_admin_id TEXT,
        author_username TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(schedule_id, occurrence_at)
      );

      CREATE TABLE IF NOT EXISTS restart_markers (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        occurrence_at TEXT NOT NULL,
        marker TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(schedule_id, occurrence_at, marker)
      );

      CREATE TABLE IF NOT EXISTS whitelist_entries (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        player_id TEXT,
        discord_id TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        created_by_admin_id TEXT,
        created_by_username TEXT,
        UNIQUE(type, value),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS whitelist_requests (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        player_name TEXT NOT NULL,
        identifiers TEXT,
        hwids TEXT,
        discord_id TEXT,
        reason TEXT,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewed_by_admin_id TEXT,
        reviewed_by_username TEXT,
        review_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS discord_status_settings (
        id TEXT PRIMARY KEY CHECK (id = 'current'),
        enabled INTEGER NOT NULL DEFAULT 0,
        guild_id TEXT,
        status_channel_id TEXT,
        status_message_id TEXT,
        update_interval_seconds INTEGER NOT NULL DEFAULT 60,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recipe_catalog_entries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        tags TEXT,
        description TEXT,
        url TEXT NOT NULL UNIQUE,
        engine INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deployer_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        recipe_name TEXT NOT NULL,
        recipe_url TEXT,
        target_path TEXT NOT NULL,
        variables TEXT,
        recipe_raw TEXT NOT NULL,
        metadata TEXT,
        validation TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS deployer_steps (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT,
        UNIQUE(job_id, step_index),
        FOREIGN KEY (job_id) REFERENCES deployer_jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS deployer_logs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES deployer_jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS onboarding_state (
        admin_id TEXT PRIMARY KEY,
        completed INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        milestone TEXT NOT NULL DEFAULT 'account_created',
        deployment_source TEXT,
        attached_target_path TEXT,
        milestones TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        skipped_at TEXT,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS deployer_plans (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        recipe_name TEXT NOT NULL,
        recipe_url TEXT,
        target_path TEXT NOT NULL,
        variables TEXT NOT NULL,
        recipe_raw TEXT NOT NULL,
        metadata TEXT NOT NULL,
        warnings TEXT NOT NULL,
        impact_summary TEXT NOT NULL,
        checks TEXT NOT NULL,
        confirmation_token_hash TEXT NOT NULL,
        created_by_admin_id TEXT,
        created_by_username TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        applied_at TEXT
      );

      CREATE TABLE IF NOT EXISTS deployer_plan_steps (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        action TEXT NOT NULL,
        impact TEXT NOT NULL,
        target TEXT,
        is_destructive INTEGER NOT NULL DEFAULT 0,
        details TEXT,
        UNIQUE(plan_id, step_index),
        FOREIGN KEY (plan_id) REFERENCES deployer_plans(id) ON DELETE CASCADE
      );
    `);

    const monitorColumns = this.db.prepare('PRAGMA table_info(monitor_players)').all() as { name: string }[];
    if (!monitorColumns.some(column => column.name === 'hwids')) {
      this.db.prepare('ALTER TABLE monitor_players ADD COLUMN hwids TEXT').run();
    }

    const moderationColumns = this.db.prepare('PRAGMA table_info(moderation_actions)').all() as { name: string }[];
    if (!moderationColumns.some(column => column.name === 'acknowledged_at')) {
      this.db.prepare('ALTER TABLE moderation_actions ADD COLUMN acknowledged_at TEXT').run();
    }
    if (!moderationColumns.some(column => column.name === 'acknowledged_by_source')) {
      this.db.prepare('ALTER TABLE moderation_actions ADD COLUMN acknowledged_by_source INTEGER').run();
    }
    if (!moderationColumns.some(column => column.name === 'acknowledgement_metadata')) {
      this.db.prepare('ALTER TABLE moderation_actions ADD COLUMN acknowledgement_metadata TEXT').run();
    }

    const deployerJobColumns = this.db.prepare('PRAGMA table_info(deployer_jobs)').all() as { name: string }[];
    if (!deployerJobColumns.some(column => column.name === 'plan_id')) {
      this.db.prepare('ALTER TABLE deployer_jobs ADD COLUMN plan_id TEXT').run();
    }
    if (!deployerJobColumns.some(column => column.name === 'resume_from_step')) {
      this.db.prepare('ALTER TABLE deployer_jobs ADD COLUMN resume_from_step INTEGER').run();
    }
    if (!deployerJobColumns.some(column => column.name === 'confirmation_hash')) {
      this.db.prepare('ALTER TABLE deployer_jobs ADD COLUMN confirmation_hash TEXT').run();
    }

    const onboardingColumns = this.db.prepare('PRAGMA table_info(onboarding_state)').all() as { name: string }[];
    if (!onboardingColumns.some(column => column.name === 'deployment_source')) {
      this.db.prepare('ALTER TABLE onboarding_state ADD COLUMN deployment_source TEXT').run();
    }
    if (!onboardingColumns.some(column => column.name === 'attached_target_path')) {
      this.db.prepare('ALTER TABLE onboarding_state ADD COLUMN attached_target_path TEXT').run();
    }

    const restartColumns = this.db.prepare('PRAGMA table_info(restart_schedules)').all() as { name: string }[];
    if (!restartColumns.some(column => column.name === 'days_of_week')) {
      this.db.prepare('ALTER TABLE restart_schedules ADD COLUMN days_of_week TEXT').run();
      this.db.prepare('UPDATE restart_schedules SET days_of_week = ? WHERE days_of_week IS NULL').run(JSON.stringify([0, 1, 2, 3, 4, 5, 6]));
    }

    this.migrateAppSettings();
  }

  private migrateAppSettings() {
    const hasDiscordSetting = this.db.prepare('SELECT 1 FROM app_settings WHERE key = ? LIMIT 1').get('discord.status');
    if (hasDiscordSetting) return;
    const legacyRow = this.db.prepare('SELECT * FROM discord_status_settings WHERE id = ?').get('current') as any;
    if (!legacyRow) return;
    const payload = {
      enabled: Boolean(legacyRow.enabled),
      guildId: legacyRow.guild_id || null,
      statusChannelId: legacyRow.status_channel_id || null,
      statusMessageId: legacyRow.status_message_id || null,
      updateIntervalSeconds: Math.max(30, Number(legacyRow.update_interval_seconds || 60)),
    };
    this.setAppSetting('discord.status', payload, 1);
  }

  getAppSetting(key: string): AppSettingRecord | null {
    const row = this.db.prepare('SELECT key, value_json, version, updated_at FROM app_settings WHERE key = ?').get(key) as any;
    if (!row) return null;
    return {
      key: row.key,
      value: row.value_json ? JSON.parse(row.value_json) : {},
      version: Number.isFinite(Number(row.version)) ? Number(row.version) : 1,
      updatedAt: row.updated_at || now(),
    };
  }

  setAppSetting(key: string, value: Record<string, unknown>, version = 1) {
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO app_settings (key, value_json, version, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value || {}), version, timestamp);
    return this.getAppSetting(key);
  }

  hasOwner() {
    const row = this.db.prepare('SELECT 1 FROM admins WHERE is_owner = 1 LIMIT 1').get();
    return Boolean(row);
  }

  createOwner(username: string, passwordHash: string) {
    const roleId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    const timestamp = now();

    const create = this.db.transaction(() => {
      this.db.prepare('INSERT INTO roles (id, name, is_owner, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
        .run(roleId, 'Owner', timestamp, timestamp);
      this.db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)')
        .run(roleId, ALL_PERMISSIONS);
      this.db.prepare(`
        INSERT INTO admins (id, username, password_hash, role_id, enabled, is_owner, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, ?)
      `).run(adminId, username, passwordHash, roleId, timestamp, timestamp);
    });

    create();
    return this.getAdminById(adminId);
  }

  getPasswordHash(username: string) {
    const row = this.db.prepare('SELECT password_hash FROM admins WHERE lower(username) = lower(?) AND enabled = 1').get(username) as { password_hash: string } | undefined;
    return row?.password_hash || null;
  }

  hasPasswordLogin(adminId: string) {
    const row = this.db.prepare('SELECT password_hash FROM admins WHERE id = ? AND enabled = 1').get(adminId) as { password_hash: string } | undefined;
    return Boolean(row?.password_hash);
  }

  getAdminByUsername(username: string) {
    const row = this.db.prepare('SELECT id FROM admins WHERE lower(username) = lower(?) AND enabled = 1').get(username) as { id: string } | undefined;
    return row ? this.getAdminById(row.id) : null;
  }

  getAdminById(id: string): AdminRecord | null {
    const row = this.db.prepare(`
      SELECT admins.id, admins.username, admins.role_id as roleId, admins.enabled, admins.is_owner as isOwner, roles.name as role
      FROM admins
      JOIN roles ON roles.id = admins.role_id
      WHERE admins.id = ?
    `).get(id) as any;

    if (!row) return null;
    const permissions = this.getRolePermissions(row.roleId);
    return {
      id: row.id,
      username: row.username,
      roleId: row.roleId,
      role: row.role,
      permissions,
      identifiers: this.getAdminIdentifiers(row.id),
      enabled: Boolean(row.enabled),
      isOwner: Boolean(row.isOwner),
    };
  }

  createSession(adminId: string, ttlHours = 24) {
    const id = crypto.randomUUID();
    const timestamp = now();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    this.db.prepare('INSERT INTO sessions (id, admin_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, adminId, timestamp, timestamp, expiresAt);
    return { id, expiresAt };
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare('SELECT id, admin_id as adminId, expires_at as expiresAt, revoked_at as revokedAt FROM sessions WHERE id = ?').get(id) as SessionRecord | undefined;
    if (!row) return null;
    if (row.revokedAt) return null;
    if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), id);
    return row;
  }

  revokeSession(id: string) {
    this.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now(), id);
  }

  listAdminProviderIdentities() {
    const rows = this.db.prepare(`
      SELECT
        identities.id,
        identities.admin_id as adminId,
        admins.username as adminUsername,
        identities.provider,
        identities.provider_user_id as providerUserId,
        identities.display_name as displayName,
        identities.identifiers,
        identities.created_at as createdAt,
        identities.updated_at as updatedAt
      FROM admin_provider_identities identities
      JOIN admins ON admins.id = identities.admin_id
      ORDER BY admins.username ASC, identities.provider ASC, identities.created_at ASC
    `).all() as any[];
    return rows.map(row => ({
      ...row,
      identifiers: this.parseJsonArray(row.identifiers),
    })) as AdminProviderIdentityRecord[];
  }

  getProviderIdentityByProviderUserId(provider: 'cfx', providerUserId: string) {
    const row = this.db.prepare(`
      SELECT
        identities.id,
        identities.admin_id as adminId,
        admins.username as adminUsername,
        identities.provider,
        identities.provider_user_id as providerUserId,
        identities.display_name as displayName,
        identities.identifiers,
        identities.created_at as createdAt,
        identities.updated_at as updatedAt
      FROM admin_provider_identities identities
      JOIN admins ON admins.id = identities.admin_id
      WHERE identities.provider = ? AND identities.provider_user_id = ?
      LIMIT 1
    `).get(provider, providerUserId) as any;
    if (!row) return null;
    return {
      ...row,
      identifiers: this.parseJsonArray(row.identifiers),
    } as AdminProviderIdentityRecord;
  }

  linkAdminProviderIdentity(input: {
    adminId: string;
    provider: 'cfx';
    providerUserId: string;
    displayName: string;
    identifiers: string[];
  }) {
    const existingOwner = this.getProviderIdentityByProviderUserId(input.provider, input.providerUserId);
    if (existingOwner && existingOwner.adminId !== input.adminId) {
      throw new Error('This provider identity is already linked to another admin');
    }

    const id = existingOwner?.id || crypto.randomUUID();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO admin_provider_identities (id, admin_id, provider, provider_user_id, display_name, identifiers, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        admin_id = excluded.admin_id,
        display_name = excluded.display_name,
        identifiers = excluded.identifiers,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.adminId,
      input.provider,
      input.providerUserId,
      input.displayName,
      JSON.stringify(cleanIdentifierList(input.identifiers)),
      existingOwner?.createdAt || timestamp,
      timestamp,
    );

    const linked = this.getProviderIdentityByProviderUserId(input.provider, input.providerUserId);
    if (!linked) throw new Error('Failed to link provider identity');
    return linked;
  }

  unlinkAdminProviderIdentity(identityId: string) {
    const row = this.db.prepare(`
      SELECT id, admin_id as adminId, provider, provider_user_id as providerUserId
      FROM admin_provider_identities
      WHERE id = ?
      LIMIT 1
    `).get(identityId) as { id: string; adminId: string; provider: 'cfx'; providerUserId: string } | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM admin_provider_identities WHERE id = ?').run(identityId);
    return row;
  }

  createProviderAuthState(input: {
    id: string;
    provider: 'cfx';
    mode: 'login' | 'link';
    nonce: string;
    actorAdminId?: string | null;
    targetAdminId?: string | null;
    returnTo?: string | null;
    expiresAt: string;
  }) {
    this.db.prepare(`
      INSERT INTO provider_auth_states (id, provider, mode, nonce, actor_admin_id, target_admin_id, return_to, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.provider,
      input.mode,
      input.nonce,
      input.actorAdminId || null,
      input.targetAdminId || null,
      input.returnTo || null,
      now(),
      input.expiresAt,
    );
  }

  consumeProviderAuthState(id: string, nonce: string) {
    const row = this.db.prepare(`
      SELECT id, provider, mode, nonce, actor_admin_id as actorAdminId, target_admin_id as targetAdminId, return_to as returnTo, created_at as createdAt, expires_at as expiresAt, consumed_at as consumedAt
      FROM provider_auth_states
      WHERE id = ?
      LIMIT 1
    `).get(id) as ProviderAuthStateRecord | undefined;
    if (!row) return null;
    if (row.consumedAt) throw new Error('This auth flow has already been used');
    if (row.nonce !== nonce) throw new Error('Invalid auth state nonce');
    if (new Date(row.expiresAt).getTime() <= Date.now()) throw new Error('Auth flow expired');

    this.db.prepare('UPDATE provider_auth_states SET consumed_at = ? WHERE id = ?').run(now(), id);
    return row;
  }

  getRolePermissions(roleId: string) {
    const rows = this.db.prepare('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission').all(roleId) as { permission: string }[];
    return rows.map(row => row.permission);
  }

  getAdminIdentifiers(adminId: string) {
    const rows = this.db.prepare('SELECT identifier FROM admin_identifiers WHERE admin_id = ? ORDER BY identifier').all(adminId) as { identifier: string }[];
    return rows.map(row => row.identifier);
  }

  setAdminIdentifiers(adminId: string, identifiers: string[]) {
    const admin = this.getAdminById(adminId);
    if (!admin) return null;
    const normalized = cleanIdentifierList(identifiers).map(identifier => identifier.toLowerCase());
    const timestamp = now();
    const update = this.db.transaction(() => {
      this.db.prepare('DELETE FROM admin_identifiers WHERE admin_id = ?').run(adminId);
      const insert = this.db.prepare('INSERT INTO admin_identifiers (admin_id, identifier, created_at) VALUES (?, ?, ?)');
      normalized.forEach(identifier => insert.run(adminId, identifier, timestamp));
    });
    update();
    return this.listAdmins().find(nextAdmin => nextAdmin.id === adminId) || null;
  }

  findAdminByIdentifiers(identifiers: string[]) {
    const normalized = cleanIdentifierList(identifiers).map(identifier => identifier.toLowerCase());
    if (!normalized.length) return null;
    const placeholders = normalized.map(() => '?').join(',');
    const row = this.db.prepare(`
      SELECT admins.id
      FROM admin_identifiers
      JOIN admins ON admins.id = admin_identifiers.admin_id
      WHERE admins.enabled = 1 AND lower(admin_identifiers.identifier) IN (${placeholders})
      LIMIT 1
    `).get(...normalized) as { id: string } | undefined;
    return row ? this.getAdminById(row.id) : null;
  }

  listRoles(): RoleRecord[] {
    const rows = this.db.prepare('SELECT id, name, is_owner as isOwner FROM roles ORDER BY is_owner DESC, name ASC').all() as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      isOwner: Boolean(row.isOwner),
      permissions: this.getRolePermissions(row.id),
    }));
  }

  createRole(name: string, permissions: string[]) {
    const id = crypto.randomUUID();
    const timestamp = now();
    const normalized = normalizePermissions(permissions);
    const create = this.db.transaction(() => {
      this.db.prepare('INSERT INTO roles (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, name, timestamp, timestamp);
      const insert = this.db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)');
      normalized.forEach(permission => insert.run(id, permission));
    });
    create();
    return this.listRoles().find(role => role.id === id)!;
  }

  updateRole(id: string, name: string, permissions: string[]) {
    const role = this.db.prepare('SELECT is_owner as isOwner FROM roles WHERE id = ?').get(id) as { isOwner: number } | undefined;
    if (!role) return null;
    const normalized = role.isOwner ? [ALL_PERMISSIONS] : normalizePermissions(permissions);
    const update = this.db.transaction(() => {
      this.db.prepare('UPDATE roles SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
      this.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
      const insert = this.db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)');
      normalized.forEach(permission => insert.run(id, permission));
    });
    update();
    return this.listRoles().find(nextRole => nextRole.id === id) || null;
  }

  deleteRole(id: string) {
    const role = this.db.prepare('SELECT is_owner as isOwner FROM roles WHERE id = ?').get(id) as { isOwner: number } | undefined;
    if (!role || role.isOwner) return false;
    const assigned = this.db.prepare('SELECT COUNT(*) as count FROM admins WHERE role_id = ?').get(id) as { count: number };
    if (assigned.count > 0) throw new Error('Cannot delete a role assigned to admins');
    this.db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    return true;
  }

  listAdmins() {
    const rows = this.db.prepare(`
      SELECT admins.id, admins.username, admins.role_id as roleId, admins.enabled, admins.is_owner as isOwner, roles.name as role
      FROM admins
      JOIN roles ON roles.id = admins.role_id
      ORDER BY admins.is_owner DESC, admins.username ASC
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      username: row.username,
      roleId: row.roleId,
      role: row.role,
      identifiers: this.getAdminIdentifiers(row.id),
      enabled: Boolean(row.enabled),
      isOwner: Boolean(row.isOwner),
    }));
  }

  createAdmin(username: string, passwordHash: string, roleId: string) {
    const role = this.db.prepare('SELECT id, is_owner as isOwner FROM roles WHERE id = ?').get(roleId) as { id: string; isOwner: number } | undefined;
    if (!role || role.isOwner) throw new Error('Select a non-owner role for new admins');

    const id = crypto.randomUUID();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO admins (id, username, password_hash, role_id, enabled, is_owner, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 0, ?, ?)
    `).run(id, username, passwordHash, roleId, timestamp, timestamp);

    return this.listAdmins().find(admin => admin.id === id)!;
  }

  assignAdminRole(adminId: string, roleId: string) {
    const admin = this.getAdminById(adminId);
    const role = this.db.prepare('SELECT id, is_owner as isOwner FROM roles WHERE id = ?').get(roleId) as { id: string; isOwner: number } | undefined;
    if (!admin || !role) return null;
    if (admin.isOwner && !role.isOwner) throw new Error('The owner admin must keep the owner role');
    this.db.prepare('UPDATE admins SET role_id = ?, updated_at = ? WHERE id = ?').run(roleId, now(), adminId);
    return this.listAdmins().find(nextAdmin => nextAdmin.id === adminId) || null;
  }

  countRecentFailedAuth(username: string, ip: string, minutes = 15) {
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM auth_attempts
      WHERE success = 0 AND timestamp >= ? AND (lower(username) = lower(?) OR ip = ?)
    `).get(since, username, ip) as { count: number };
    return row.count;
  }

  recordAuthAttempt(username: string, ip: string, success: boolean, reason: string) {
    this.db.prepare('INSERT INTO auth_attempts (id, timestamp, username, ip, success, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), now(), username, ip, success ? 1 : 0, reason);
  }

  logAction(input: {
    actorAdminId?: string | null;
    actorUsername?: string | null;
    action: string;
    method?: string | null;
    route?: string | null;
    permission?: string | null;
    status: string;
    ip?: string | null;
    details?: unknown;
  }) {
    this.db.prepare(`
      INSERT INTO admin_action_logs (id, timestamp, actor_admin_id, actor_username, action, method, route, permission, status, ip, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      now(),
      input.actorAdminId || null,
      input.actorUsername || null,
      input.action,
      input.method || null,
      input.route || null,
      input.permission || null,
      input.status,
      input.ip || null,
      input.details === undefined ? null : JSON.stringify(input.details)
    );
  }

  recentActionLogs(limit = 100) {
    return this.db.prepare(`
      SELECT id, timestamp, actor_username as actorUsername, action, method, route, permission, status, ip, details
      FROM admin_action_logs
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit).map((row: any) => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : null,
    }));
  }

  recordConsoleCommand(input: {
    adminId?: string | null;
    username?: string | null;
    command: string;
    status: string;
    output?: string | null;
  }) {
    this.db.prepare(`
      INSERT INTO console_command_history (id, timestamp, admin_id, username, command, status, output)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      now(),
      input.adminId || null,
      input.username || null,
      input.command,
      input.status,
      input.output || null
    );
  }

  recentConsoleCommands(adminId?: string | null, limit = 50) {
    const sql = adminId
      ? `SELECT id, timestamp, username, command, status, output FROM console_command_history WHERE admin_id = ? ORDER BY timestamp DESC LIMIT ?`
      : `SELECT id, timestamp, username, command, status, output FROM console_command_history ORDER BY timestamp DESC LIMIT ?`;
    const params = adminId ? [adminId, limit] : [limit];
    return this.db.prepare(sql).all(...params);
  }

  getWhitelistMode(): WhitelistMode {
    const mode = (process.env.PORTSIDE_WHITELIST_MODE || 'disabled').toLowerCase();
    return mode === 'enforced' || mode === 'dry-run' ? mode : 'disabled';
  }

  private mapWhitelistEntry(row: any): WhitelistEntryRecord {
    return {
      id: row.id,
      type: row.type === 'discord' || row.type === 'player' ? row.type : 'identifier',
      value: row.value,
      playerId: row.player_id,
      discordId: row.discord_id,
      note: row.note,
      createdAt: row.created_at,
      createdByUsername: row.created_by_username,
    };
  }

  listWhitelistEntries(): WhitelistEntryRecord[] {
    return (this.db.prepare(`
      SELECT id, type, value, player_id, discord_id, note, created_at, created_by_username
      FROM whitelist_entries
      ORDER BY created_at DESC
    `).all() as any[]).map(row => this.mapWhitelistEntry(row));
  }

  createWhitelistEntry(input: {
    type: WhitelistEntryType;
    value: string;
    playerId?: string | null;
    discordId?: string | null;
    note?: string | null;
    actorAdminId?: string | null;
    actorUsername?: string | null;
  }) {
    const id = crypto.randomUUID();
    const timestamp = now();
    const value = input.value.trim().toLowerCase();
    this.db.prepare(`
      INSERT INTO whitelist_entries (id, type, value, player_id, discord_id, note, created_at, created_by_admin_id, created_by_username)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      value,
      input.playerId || null,
      input.discordId || (input.type === 'discord' ? value : null),
      input.note || null,
      timestamp,
      input.actorAdminId || null,
      input.actorUsername || null
    );
    return this.listWhitelistEntries().find(entry => entry.id === id)!;
  }

  deleteWhitelistEntry(id: string) {
    const result = this.db.prepare('DELETE FROM whitelist_entries WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private mapWhitelistRequest(row: any): WhitelistRequestRecord {
    return {
      id: row.id,
      status: row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending',
      playerName: row.player_name,
      identifiers: this.parseJsonArray(row.identifiers),
      hwids: this.parseJsonArray(row.hwids),
      discordId: row.discord_id,
      reason: row.reason,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewedByUsername: row.reviewed_by_username,
      reviewReason: row.review_reason,
    };
  }

  listWhitelistRequests(status?: string): WhitelistRequestRecord[] {
    const rows = status && ['pending', 'approved', 'rejected'].includes(status)
      ? this.db.prepare('SELECT * FROM whitelist_requests WHERE status = ? ORDER BY created_at DESC').all(status) as any[]
      : this.db.prepare('SELECT * FROM whitelist_requests ORDER BY created_at DESC').all() as any[];
    return rows.map(row => this.mapWhitelistRequest(row));
  }

  getWhitelistRequest(id: string): WhitelistRequestRecord | null {
    const row = this.db.prepare('SELECT * FROM whitelist_requests WHERE id = ?').get(id) as any;
    return row ? this.mapWhitelistRequest(row) : null;
  }

  createWhitelistRequest(input: {
    playerName: string;
    identifiers?: string[];
    hwids?: string[];
    discordId?: string | null;
    reason?: string | null;
  }) {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO whitelist_requests (id, status, player_name, identifiers, hwids, discord_id, reason, created_at)
      VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.playerName || 'Unknown Player',
      JSON.stringify(cleanIdentifierList(input.identifiers)),
      JSON.stringify(cleanIdentifierList(input.hwids)),
      input.discordId || null,
      input.reason || null,
      now()
    );
    return this.getWhitelistRequest(id)!;
  }

  reviewWhitelistRequest(input: {
    id: string;
    status: 'approved' | 'rejected';
    reason?: string | null;
    actorAdminId?: string | null;
    actorUsername?: string | null;
  }) {
    const request = this.getWhitelistRequest(input.id);
    if (!request) return null;
    const timestamp = now();
    const review = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE whitelist_requests
        SET status = ?, reviewed_at = ?, reviewed_by_admin_id = ?, reviewed_by_username = ?, review_reason = ?
        WHERE id = ?
      `).run(input.status, timestamp, input.actorAdminId || null, input.actorUsername || null, input.reason || null, input.id);

      if (input.status === 'approved') {
        const identifiers = cleanIdentifierList(request.identifiers);
        const primaryIdentifier = identifiers[0];
        if (primaryIdentifier) {
          try {
            this.createWhitelistEntry({
              type: 'identifier',
              value: primaryIdentifier,
              note: `Approved request from ${request.playerName}`,
              actorAdminId: input.actorAdminId,
              actorUsername: input.actorUsername,
            });
          } catch {
            // Existing whitelist entries are treated as already approved.
          }
        }
        if (request.discordId) {
          try {
            this.createWhitelistEntry({
              type: 'discord',
              value: request.discordId,
              discordId: request.discordId,
              note: `Approved request from ${request.playerName}`,
              actorAdminId: input.actorAdminId,
              actorUsername: input.actorUsername,
            });
          } catch {
            // Existing whitelist entries are treated as already approved.
          }
        }
      }
    });
    review();
    return this.getWhitelistRequest(input.id);
  }

  private whitelistAllows(player: PlayerRecord | null, identifiers: string[], discordId?: string | null) {
    const normalizedIdentifiers = cleanIdentifierList(identifiers).map(identifier => identifier.toLowerCase());
    const normalizedDiscordId = typeof discordId === 'string' ? discordId.trim().toLowerCase() : '';
    const entries = this.listWhitelistEntries();
    return entries.some(entry => {
      if (entry.type === 'identifier') return normalizedIdentifiers.includes(entry.value);
      if (entry.type === 'discord') return normalizedDiscordId && entry.value === normalizedDiscordId;
      if (entry.type === 'player') return player && entry.playerId === player.id;
      return false;
    });
  }

  getDiscordStatusSettings(): DiscordStatusSettingsRecord {
    const envGuildId = process.env.PORTSIDE_DISCORD_GUILD_ID || null;
    const envChannelId = process.env.PORTSIDE_DISCORD_STATUS_CHANNEL_ID || null;
    const envMessageId = process.env.PORTSIDE_DISCORD_STATUS_MESSAGE_ID || null;
    const setting = this.getAppSetting('discord.status');
    const settingValue = setting?.value || {};
    const row = this.db.prepare('SELECT * FROM discord_status_settings WHERE id = ?').get('current') as any;
    const enabled = typeof settingValue.enabled === 'boolean' ? settingValue.enabled : Boolean(row?.enabled);
    const guildId = typeof settingValue.guildId === 'string' ? settingValue.guildId : (settingValue.guildId === null ? null : row?.guild_id || envGuildId);
    const statusChannelId = typeof settingValue.statusChannelId === 'string'
      ? settingValue.statusChannelId
      : (settingValue.statusChannelId === null ? null : row?.status_channel_id || envChannelId);
    const statusMessageId = typeof settingValue.statusMessageId === 'string'
      ? settingValue.statusMessageId
      : (settingValue.statusMessageId === null ? null : row?.status_message_id || envMessageId);
    const updateIntervalSeconds = Math.max(
      30,
      Number(
        typeof settingValue.updateIntervalSeconds === 'number'
          ? settingValue.updateIntervalSeconds
          : (row?.update_interval_seconds || process.env.PORTSIDE_DISCORD_STATUS_INTERVAL_SECONDS || 60)
      ),
    );
    return {
      enabled,
      guildId,
      statusChannelId,
      statusMessageId,
      updateIntervalSeconds,
      updatedAt: setting?.updatedAt || row?.updated_at || now(),
    };
  }

  updateDiscordStatusSettings(input: {
    enabled: boolean;
    guildId?: string | null;
    statusChannelId?: string | null;
    statusMessageId?: string | null;
    updateIntervalSeconds?: number;
  }) {
    const timestamp = now();
    const interval = Math.max(30, Math.min(Number(input.updateIntervalSeconds || 60), 3600));
    this.db.prepare(`
      INSERT INTO discord_status_settings (id, enabled, guild_id, status_channel_id, status_message_id, update_interval_seconds, updated_at)
      VALUES ('current', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        guild_id = excluded.guild_id,
        status_channel_id = excluded.status_channel_id,
        status_message_id = excluded.status_message_id,
        update_interval_seconds = excluded.update_interval_seconds,
        updated_at = excluded.updated_at
    `).run(
      input.enabled ? 1 : 0,
      input.guildId || null,
      input.statusChannelId || null,
      input.statusMessageId || null,
      interval,
      timestamp
    );
    this.setAppSetting('discord.status', {
      enabled: input.enabled,
      guildId: input.guildId || null,
      statusChannelId: input.statusChannelId || null,
      statusMessageId: input.statusMessageId || null,
      updateIntervalSeconds: interval,
    }, 1);
    return this.getDiscordStatusSettings();
  }

  getUpdatesConfig(): UpdatesConfigRecord {
    const setting = this.getAppSetting('updates.config');
    const value = setting?.value || {};
    const owner = typeof value.owner === 'string' && value.owner.trim() ? value.owner.trim() : 'RebelFinatic';
    const repo = typeof value.repo === 'string' && value.repo.trim() ? value.repo.trim() : 'portside';
    return {
      source: 'github-releases',
      owner,
      repo,
    };
  }

  updateUpdatesConfig(input: Partial<UpdatesConfigRecord>) {
    const current = this.getUpdatesConfig();
    const next: UpdatesConfigRecord = {
      source: 'github-releases',
      owner: typeof input.owner === 'string' && input.owner.trim() ? input.owner.trim() : current.owner,
      repo: typeof input.repo === 'string' && input.repo.trim() ? input.repo.trim() : current.repo,
    };
    this.setAppSetting('updates.config', {
      source: next.source,
      owner: next.owner,
      repo: next.repo,
    }, 1);
    return next;
  }

  getUpdatesCache(): UpdatesCacheRecord | null {
    const setting = this.getAppSetting('updates.cache');
    if (!setting) return null;
    const value = setting.value || {};
    return {
      source: 'github-releases',
      owner: typeof value.owner === 'string' ? value.owner : 'RebelFinatic',
      repo: typeof value.repo === 'string' ? value.repo : 'portside',
      latestVersion: typeof value.latestVersion === 'string' ? value.latestVersion : null,
      checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : setting.updatedAt,
      releases: Array.isArray(value.releases) ? value.releases as UpdateReleaseRecord[] : [],
      fetchError: typeof value.fetchError === 'string' ? value.fetchError : null,
    };
  }

  setUpdatesCache(input: UpdatesCacheRecord) {
    this.setAppSetting('updates.cache', {
      source: input.source,
      owner: input.owner,
      repo: input.repo,
      latestVersion: input.latestVersion,
      checkedAt: input.checkedAt,
      releases: input.releases,
      fetchError: input.fetchError,
    }, 1);
    return this.getUpdatesCache();
  }

  getDefaultDeployerTargetPath() {
    const setting = this.getAppSetting('deployer.defaultTargetPath');
    if (!setting) return null;
    const value = setting.value || {};
    return typeof value.path === 'string' && value.path.trim() ? value.path : null;
  }

  setDefaultDeployerTargetPath(targetPath: string) {
    this.setAppSetting('deployer.defaultTargetPath', { path: targetPath }, 1);
    return this.getDefaultDeployerTargetPath();
  }

  private mapRecipeCatalogEntry(row: any): RecipeCatalogEntryRecord {
    return {
      id: row.id,
      name: row.name,
      source: row.source,
      tags: row.tags ? JSON.parse(row.tags) : [],
      description: row.description,
      url: row.url,
      engine: row.engine,
      updatedAt: row.updated_at,
    };
  }

  upsertRecipeCatalog(entries: Array<Omit<RecipeCatalogEntryRecord, 'updatedAt'>>) {
    const timestamp = now();
    const write = this.db.transaction(() => {
      const insert = this.db.prepare(`
        INSERT INTO recipe_catalog_entries (id, name, source, tags, description, url, engine, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          id = excluded.id,
          name = excluded.name,
          source = excluded.source,
          tags = excluded.tags,
          description = excluded.description,
          url = excluded.url,
          engine = excluded.engine,
          updated_at = excluded.updated_at
      `);
      entries.forEach(entry => insert.run(
        entry.id,
        entry.name,
        entry.source,
        JSON.stringify(entry.tags || []),
        entry.description || null,
        entry.url,
        entry.engine,
        timestamp
      ));
    });
    write();
    return this.listRecipeCatalog();
  }

  listRecipeCatalog(): RecipeCatalogEntryRecord[] {
    const rows = this.db.prepare(`
      SELECT id, name, source, tags, description, url, engine, updated_at
      FROM recipe_catalog_entries
      ORDER BY CASE source WHEN 'portside' THEN 0 WHEN 'txadmin' THEN 1 ELSE 2 END, name ASC
    `).all() as any[];
    return rows.map(row => this.mapRecipeCatalogEntry(row));
  }

  getRecipeCatalogEntry(id: string) {
    const row = this.db.prepare(`
      SELECT id, name, source, tags, description, url, engine, updated_at
      FROM recipe_catalog_entries
      WHERE id = ?
    `).get(id) as any;
    return row ? this.mapRecipeCatalogEntry(row) : null;
  }

  private mapDeployerJob(row: any): DeployerJobRecord {
    return {
      id: row.id,
      status: row.status,
      planId: row.plan_id || null,
      recipeName: row.recipe_name,
      recipeUrl: row.recipe_url,
      targetPath: row.target_path,
      variables: row.variables ? JSON.parse(row.variables) : {},
      recipeRaw: row.recipe_raw,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      validation: row.validation ? JSON.parse(row.validation) : null,
      resumeFromStep: Number.isFinite(Number(row.resume_from_step)) ? Number(row.resume_from_step) : null,
      confirmationHash: row.confirmation_hash || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
    };
  }

  createDeployerJob(input: {
    status?: string;
    planId?: string | null;
    recipeName: string;
    recipeUrl?: string | null;
    targetPath: string;
    variables: Record<string, unknown>;
    recipeRaw: string;
    metadata: Record<string, unknown>;
    resumeFromStep?: number | null;
    confirmationHash?: string | null;
  }) {
    const id = crypto.randomUUID();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO deployer_jobs (id, status, plan_id, recipe_name, recipe_url, target_path, variables, recipe_raw, metadata, resume_from_step, confirmation_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.status || 'pending',
      input.planId || null,
      input.recipeName,
      input.recipeUrl || null,
      input.targetPath,
      JSON.stringify(input.variables || {}),
      input.recipeRaw,
      JSON.stringify(input.metadata || {}),
      input.resumeFromStep === undefined ? null : input.resumeFromStep,
      input.confirmationHash || null,
      timestamp,
      timestamp
    );
    return this.getDeployerJob(id)!;
  }

  getDeployerJob(id: string, options?: { includeSecrets?: boolean }) {
    const row = this.db.prepare('SELECT * FROM deployer_jobs WHERE id = ?').get(id) as any;
    const job = row ? this.mapDeployerJob(row) : null;
    if (!job || options?.includeSecrets) return job;
    job.variables = redactRecord(job.variables);
    job.recipeRaw = '';
    return job;
  }

  listDeployerJobs(limit = 50) {
    const rows = this.db.prepare('SELECT * FROM deployer_jobs ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
    return rows.map(row => {
      const job = this.mapDeployerJob(row);
      job.variables = redactRecord(job.variables);
      job.recipeRaw = '';
      return job;
    });
  }

  updateDeployerJob(id: string, input: {
    status?: string;
    validation?: Record<string, unknown> | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
    resumeFromStep?: number | null;
    confirmationHash?: string | null;
  }) {
    const existing = this.getDeployerJob(id, { includeSecrets: true });
    if (!existing) return null;
    this.db.prepare(`
      UPDATE deployer_jobs
      SET status = ?, validation = ?, started_at = ?, finished_at = ?, error = ?, resume_from_step = ?, confirmation_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status || existing.status,
      input.validation === undefined ? (existing.validation ? JSON.stringify(existing.validation) : null) : (input.validation ? JSON.stringify(input.validation) : null),
      input.startedAt === undefined ? existing.startedAt : input.startedAt,
      input.finishedAt === undefined ? existing.finishedAt : input.finishedAt,
      input.error === undefined ? existing.error : input.error,
      input.resumeFromStep === undefined ? existing.resumeFromStep : input.resumeFromStep,
      input.confirmationHash === undefined ? existing.confirmationHash : input.confirmationHash,
      now(),
      id
    );
    return this.getDeployerJob(id);
  }

  createDeployerStep(input: {
    jobId: string;
    stepIndex: number;
    label: string;
    action: string;
  }) {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO deployer_steps (id, job_id, step_index, label, action, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(id, input.jobId, input.stepIndex, input.label, input.action);
    return id;
  }

  updateDeployerStep(id: string, input: { status: string; error?: string | null; startedAt?: string | null; finishedAt?: string | null }) {
    const row = this.db.prepare('SELECT * FROM deployer_steps WHERE id = ?').get(id) as any;
    if (!row) return null;
    this.db.prepare(`
      UPDATE deployer_steps
      SET status = ?, started_at = ?, finished_at = ?, error = ?
      WHERE id = ?
    `).run(
      input.status,
      input.startedAt === undefined ? row.started_at : input.startedAt,
      input.finishedAt === undefined ? row.finished_at : input.finishedAt,
      input.error === undefined ? row.error : input.error,
      id
    );
    return id;
  }

  listDeployerSteps(jobId: string): DeployerStepRecord[] {
    const rows = this.db.prepare(`
      SELECT id, job_id as jobId, step_index as stepIndex, label, action, status, started_at as startedAt, finished_at as finishedAt, error
      FROM deployer_steps
      WHERE job_id = ?
      ORDER BY step_index ASC
    `).all(jobId) as DeployerStepRecord[];
    return rows;
  }

  addDeployerLog(jobId: string, level: string, message: string) {
    this.db.prepare('INSERT INTO deployer_logs (id, job_id, timestamp, level, message) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), jobId, now(), level, message);
  }

  listDeployerLogs(jobId: string, limit = 250): DeployerLogRecord[] {
    const rows = this.db.prepare(`
      SELECT id, job_id as jobId, timestamp, level, message
      FROM deployer_logs
      WHERE job_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(jobId, limit) as DeployerLogRecord[];
    return rows;
  }

  private defaultOnboardingMilestones() {
    return {
      account_created: null,
      environment_checked: null,
      recipe_selected: null,
      variables_completed: null,
      deployment_planned: null,
      deployment_applied: null,
      go_live_ready: null,
    } as Record<OnboardingMilestone, string | null>;
  }

  private parseOnboardingMilestones(value: unknown) {
    const base = this.defaultOnboardingMilestones();
    const parsed = typeof value === 'string' && value ? JSON.parse(value) : {};
    for (const key of Object.keys(base) as OnboardingMilestone[]) {
      const next = (parsed as Record<string, unknown>)[key];
      if (typeof next === 'string' || next === null) {
        base[key] = next;
      }
    }
    return base;
  }

  private mapOnboardingState(row: any): OnboardingStateRecord {
    return {
      adminId: row.admin_id,
      completed: Boolean(row.completed),
      skipped: Boolean(row.skipped),
      milestone: row.milestone,
      deploymentSource: row.deployment_source || null,
      attachedTargetPath: row.attached_target_path || null,
      defaultTargetPath: this.getDefaultDeployerTargetPath(),
      milestones: this.parseOnboardingMilestones(row.milestones),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      skippedAt: row.skipped_at,
    };
  }

  getOnboardingState(adminId: string) {
    const existing = this.db.prepare('SELECT * FROM onboarding_state WHERE admin_id = ?').get(adminId) as any;
    if (existing) return this.mapOnboardingState(existing);

    const timestamp = now();
    this.db.prepare(`
      INSERT INTO onboarding_state (admin_id, completed, skipped, milestone, milestones, created_at, updated_at)
      VALUES (?, 0, 0, 'account_created', ?, ?, ?)
    `).run(adminId, JSON.stringify(this.defaultOnboardingMilestones()), timestamp, timestamp);
    const created = this.db.prepare('SELECT * FROM onboarding_state WHERE admin_id = ?').get(adminId) as any;
    return this.mapOnboardingState(created);
  }

  upsertOnboardingState(adminId: string, input: {
    milestone?: OnboardingMilestone;
    deploymentSource?: OnboardingDeploymentSource | null;
    attachedTargetPath?: string | null;
    completed?: boolean;
    skipped?: boolean;
    completedAt?: string | null;
    skippedAt?: string | null;
    milestoneTimestamp?: string | null;
  }) {
    const existing = this.getOnboardingState(adminId);
    const timestamp = now();
    const milestones = { ...existing.milestones };
    if (input.milestone) {
      milestones[input.milestone] = input.milestoneTimestamp === undefined ? timestamp : input.milestoneTimestamp;
    }
    const completed = input.completed === undefined ? existing.completed : input.completed;
    const skipped = input.skipped === undefined ? existing.skipped : input.skipped;
    this.db.prepare(`
      UPDATE onboarding_state
      SET completed = ?, skipped = ?, milestone = ?, deployment_source = ?, attached_target_path = ?, milestones = ?, completed_at = ?, skipped_at = ?, updated_at = ?
      WHERE admin_id = ?
    `).run(
      completed ? 1 : 0,
      skipped ? 1 : 0,
      input.milestone || existing.milestone,
      input.deploymentSource === undefined ? existing.deploymentSource : input.deploymentSource,
      input.attachedTargetPath === undefined ? existing.attachedTargetPath : input.attachedTargetPath,
      JSON.stringify(milestones),
      input.completedAt === undefined ? existing.completedAt : input.completedAt,
      input.skippedAt === undefined ? existing.skippedAt : input.skippedAt,
      timestamp,
      adminId
    );
    return this.getOnboardingState(adminId);
  }

  private mapDeployerPlan(row: any): DeployerPlanRecord {
    return {
      id: row.id,
      status: row.status,
      recipeName: row.recipe_name,
      recipeUrl: row.recipe_url,
      targetPath: row.target_path,
      variables: row.variables ? JSON.parse(row.variables) : {},
      recipeRaw: row.recipe_raw,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      warnings: row.warnings ? JSON.parse(row.warnings) : [],
      impactSummary: row.impact_summary ? JSON.parse(row.impact_summary) : {},
      checks: row.checks ? JSON.parse(row.checks) : {},
      confirmationTokenHash: row.confirmation_token_hash,
      createdByAdminId: row.created_by_admin_id,
      createdByUsername: row.created_by_username,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      appliedAt: row.applied_at,
    };
  }

  createDeployerPlan(input: {
    status?: DeployerPlanRecord['status'];
    recipeName: string;
    recipeUrl?: string | null;
    targetPath: string;
    variables: Record<string, unknown>;
    recipeRaw: string;
    metadata: Record<string, unknown>;
    warnings: string[];
    impactSummary: Record<string, unknown>;
    checks: Record<string, unknown>;
    confirmationTokenHash: string;
    createdByAdminId?: string | null;
    createdByUsername?: string | null;
  }) {
    const id = crypto.randomUUID();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO deployer_plans (
        id, status, recipe_name, recipe_url, target_path, variables, recipe_raw, metadata, warnings,
        impact_summary, checks, confirmation_token_hash, created_by_admin_id, created_by_username, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.status || 'planned',
      input.recipeName,
      input.recipeUrl || null,
      input.targetPath,
      JSON.stringify(input.variables || {}),
      input.recipeRaw,
      JSON.stringify(input.metadata || {}),
      JSON.stringify(input.warnings || []),
      JSON.stringify(input.impactSummary || {}),
      JSON.stringify(input.checks || {}),
      input.confirmationTokenHash,
      input.createdByAdminId || null,
      input.createdByUsername || null,
      timestamp,
      timestamp
    );
    return this.getDeployerPlan(id, { includeSecrets: true })!;
  }

  getDeployerPlan(id: string, options?: { includeSecrets?: boolean }) {
    const row = this.db.prepare('SELECT * FROM deployer_plans WHERE id = ?').get(id) as any;
    const plan = row ? this.mapDeployerPlan(row) : null;
    if (!plan || options?.includeSecrets) return plan;
    return {
      ...plan,
      variables: redactRecord(plan.variables),
      recipeRaw: '',
      confirmationTokenHash: '',
    };
  }

  updateDeployerPlan(id: string, input: {
    status?: DeployerPlanRecord['status'];
    checks?: Record<string, unknown>;
    warnings?: string[];
    impactSummary?: Record<string, unknown>;
    appliedAt?: string | null;
  }) {
    const existing = this.getDeployerPlan(id, { includeSecrets: true });
    if (!existing) return null;
    this.db.prepare(`
      UPDATE deployer_plans
      SET status = ?, warnings = ?, impact_summary = ?, checks = ?, applied_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status || existing.status,
      input.warnings === undefined ? JSON.stringify(existing.warnings) : JSON.stringify(input.warnings || []),
      input.impactSummary === undefined ? JSON.stringify(existing.impactSummary) : JSON.stringify(input.impactSummary || {}),
      input.checks === undefined ? JSON.stringify(existing.checks) : JSON.stringify(input.checks || {}),
      input.appliedAt === undefined ? existing.appliedAt : input.appliedAt,
      now(),
      id
    );
    return this.getDeployerPlan(id);
  }

  createDeployerPlanStep(input: {
    planId: string;
    stepIndex: number;
    label: string;
    action: string;
    impact: string;
    target?: string | null;
    isDestructive?: boolean;
    details?: Record<string, unknown> | null;
  }) {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO deployer_plan_steps (id, plan_id, step_index, label, action, impact, target, is_destructive, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.planId,
      input.stepIndex,
      input.label,
      input.action,
      input.impact,
      input.target || null,
      input.isDestructive ? 1 : 0,
      input.details ? JSON.stringify(input.details) : null
    );
    return id;
  }

  listDeployerPlanSteps(planId: string): DeployerPlanStepRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        plan_id as planId,
        step_index as stepIndex,
        label,
        action,
        impact,
        target,
        is_destructive as isDestructive,
        details
      FROM deployer_plan_steps
      WHERE plan_id = ?
      ORDER BY step_index ASC
    `).all(planId) as any[];
    return rows.map(row => ({
      ...row,
      isDestructive: Boolean(row.isDestructive),
      details: row.details ? JSON.parse(row.details) : null,
    }));
  }

  private mapRestartSchedule(row: any): RestartScheduleRecord {
    const parsedDays = this.parseJsonArray(row.days_of_week)
      .filter((value: unknown): value is number => Number.isInteger(Number(value)))
      .map(Number)
      .filter(day => day >= 0 && day <= 6);
    return {
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      type: row.type === 'temporary' ? 'temporary' : 'daily',
      timeOfDay: row.time_of_day,
      executeAt: row.execute_at,
      daysOfWeek: parsedDays.length > 0 ? parsedDays : [0, 1, 2, 3, 4, 5, 6],
      warningMinutes: this.parseJsonArray(row.warning_minutes).filter((value: unknown): value is number => Number.isFinite(Number(value))).map(Number),
      message: row.message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listRestartSchedules(): RestartScheduleRecord[] {
    const rows = this.db.prepare(`
      SELECT id, name, enabled, type, time_of_day, execute_at, days_of_week, warning_minutes, message, created_at, updated_at
      FROM restart_schedules
      ORDER BY enabled DESC, type ASC, COALESCE(execute_at, time_of_day) ASC
    `).all() as any[];
    return rows.map(row => this.mapRestartSchedule(row));
  }

  getRestartSchedule(id: string): RestartScheduleRecord | null {
    const row = this.db.prepare(`
      SELECT id, name, enabled, type, time_of_day, execute_at, days_of_week, warning_minutes, message, created_at, updated_at
      FROM restart_schedules
      WHERE id = ?
    `).get(id) as any;
    return row ? this.mapRestartSchedule(row) : null;
  }

  createRestartSchedule(input: {
    name: string;
    type: 'daily' | 'temporary';
    timeOfDay?: string | null;
    executeAt?: string | null;
    daysOfWeek?: number[];
    warningMinutes?: number[];
    message?: string | null;
    enabled?: boolean;
  }) {
    const id = crypto.randomUUID();
    const timestamp = now();
    const warnings = normalizeWarningMinutes(input.warningMinutes);
    const daysOfWeek = normalizeDaysOfWeek(input.daysOfWeek);
    this.db.prepare(`
      INSERT INTO restart_schedules (id, name, enabled, type, time_of_day, execute_at, days_of_week, warning_minutes, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.enabled === false ? 0 : 1,
      input.type,
      input.timeOfDay || null,
      input.executeAt || null,
      JSON.stringify(daysOfWeek),
      JSON.stringify(warnings),
      input.message || null,
      timestamp,
      timestamp
    );
    return this.getRestartSchedule(id)!;
  }

  updateRestartSchedule(id: string, input: {
    name: string;
    enabled: boolean;
    timeOfDay?: string | null;
    executeAt?: string | null;
    daysOfWeek?: number[];
    warningMinutes?: number[];
    message?: string | null;
  }) {
    const existing = this.getRestartSchedule(id);
    if (!existing) return null;
    this.db.prepare(`
      UPDATE restart_schedules
      SET name = ?, enabled = ?, time_of_day = ?, execute_at = ?, days_of_week = ?, warning_minutes = ?, message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name,
      input.enabled ? 1 : 0,
      input.timeOfDay || null,
      input.executeAt || null,
      JSON.stringify(normalizeDaysOfWeek(input.daysOfWeek ?? existing.daysOfWeek)),
      JSON.stringify(normalizeWarningMinutes(input.warningMinutes)),
      input.message || null,
      now(),
      id
    );
    return this.getRestartSchedule(id);
  }

  deleteRestartSchedule(id: string) {
    const result = this.db.prepare('DELETE FROM restart_schedules WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM restart_skips WHERE schedule_id = ?').run(id);
    this.db.prepare('DELETE FROM restart_markers WHERE schedule_id = ?').run(id);
    return result.changes > 0;
  }

  skipRestartOccurrence(input: {
    scheduleId: string;
    occurrenceAt: string;
    temporary?: boolean;
    authorAdminId?: string | null;
    authorUsername?: string | null;
  }) {
    this.db.prepare(`
      INSERT INTO restart_skips (id, schedule_id, occurrence_at, temporary, author_admin_id, author_username, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(schedule_id, occurrence_at) DO UPDATE SET
        temporary = excluded.temporary,
        author_admin_id = excluded.author_admin_id,
        author_username = excluded.author_username,
        created_at = excluded.created_at
    `).run(
      crypto.randomUUID(),
      input.scheduleId,
      input.occurrenceAt,
      input.temporary === false ? 0 : 1,
      input.authorAdminId || null,
      input.authorUsername || null,
      now()
    );
  }

  isRestartSkipped(scheduleId: string, occurrenceAt: string) {
    const row = this.db.prepare('SELECT 1 FROM restart_skips WHERE schedule_id = ? AND occurrence_at = ?').get(scheduleId, occurrenceAt);
    return Boolean(row);
  }

  markRestartEvent(scheduleId: string, occurrenceAt: string, marker: string) {
    try {
      this.db.prepare(`
        INSERT INTO restart_markers (id, schedule_id, occurrence_at, marker, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), scheduleId, occurrenceAt, marker, now());
      return true;
    } catch (error: any) {
      if (String(error.message || '').includes('UNIQUE')) return false;
      throw error;
    }
  }

  upsertMonitorHeartbeat(input: {
    resourceName: string;
    version?: string | null;
    gameName?: string | null;
    serverName?: string | null;
    players?: number | null;
    maxPlayers?: number | null;
    debug?: boolean;
  }) {
    this.db.prepare(`
      INSERT INTO monitor_heartbeat (id, timestamp, resource_name, version, game_name, server_name, players, max_players, debug)
      VALUES ('current', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        timestamp = excluded.timestamp,
        resource_name = excluded.resource_name,
        version = excluded.version,
        game_name = excluded.game_name,
        server_name = excluded.server_name,
        players = excluded.players,
        max_players = excluded.max_players,
        debug = excluded.debug
    `).run(
      now(),
      input.resourceName,
      input.version || null,
      input.gameName || null,
      input.serverName || null,
      input.players ?? null,
      input.maxPlayers ?? null,
      input.debug ? 1 : 0
    );
    return this.getMonitorStatus();
  }

  getMonitorStatus() {
    const row = this.db.prepare(`
      SELECT id, timestamp, resource_name as resourceName, version, game_name as gameName, server_name as serverName,
        players, max_players as maxPlayers, debug
      FROM monitor_heartbeat
      WHERE id = 'current'
    `).get() as any;

    if (!row) {
      return {
        installed: false,
        online: false,
        configured: Boolean(process.env.PORTSIDE_MONITOR_TOKEN),
        lastHeartbeatAt: null,
        staleAfterSeconds: 30,
      };
    }

    const ageMs = Date.now() - new Date(row.timestamp).getTime();
    return {
      installed: true,
      online: ageMs <= 30000,
      configured: Boolean(process.env.PORTSIDE_MONITOR_TOKEN),
      lastHeartbeatAt: row.timestamp,
      staleAfterSeconds: 30,
      resourceName: row.resourceName,
      version: row.version,
      gameName: row.gameName,
      serverName: row.serverName,
      players: row.players,
      maxPlayers: row.maxPlayers,
      debug: Boolean(row.debug),
    };
  }

  upsertMonitorResources(resources: MonitorResourceRecord[]) {
    const timestamp = now();
    const sync = this.db.transaction(() => {
      const seen = new Set<string>();
      const upsert = this.db.prepare(`
        INSERT INTO monitor_resources (name, state, path, author, version, description, dependencies, metadata, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          state = excluded.state,
          path = excluded.path,
          author = excluded.author,
          version = excluded.version,
          description = excluded.description,
          dependencies = excluded.dependencies,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
      `);

      resources.forEach(resource => {
        seen.add(resource.name);
        upsert.run(
          resource.name,
          resource.state || 'unknown',
          resource.path || null,
          resource.author || null,
          resource.version || null,
          resource.description || null,
          JSON.stringify(resource.dependencies || []),
          resource.metadata ? JSON.stringify(resource.metadata) : null,
          timestamp
        );
      });

      if (seen.size > 0) {
        const placeholders = Array.from(seen).map(() => '?').join(',');
        this.db.prepare(`DELETE FROM monitor_resources WHERE name NOT IN (${placeholders})`).run(...seen);
      } else {
        this.db.prepare('DELETE FROM monitor_resources').run();
      }
    });

    sync();
    return this.listMonitorResources();
  }

  listMonitorResources(): MonitorResourceRecord[] {
    const rows = this.db.prepare(`
      SELECT name, state, path, author, version, description, dependencies, metadata, updated_at as updatedAt
      FROM monitor_resources
      ORDER BY name ASC
    `).all() as any[];

    return rows.map(row => ({
      ...row,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));
  }

  private parseJsonArray(value: string | null | undefined) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private normalizePlayerName(value: string | null | undefined) {
    return (value || '').trim().toLowerCase();
  }

  private playerHasIdentity(player: Pick<PlayerRecord, 'identifiers' | 'hwids'>) {
    return player.identifiers.length > 0 || player.hwids.length > 0;
  }

  private findPlayerByIdentifiersOrHwids(identifiers: string[], hwids: string[]): PlayerRecord | null {
    const rows = this.db.prepare('SELECT * FROM players').all() as any[];
    const match = rows.find(row => (
      listsOverlap(this.parseJsonArray(row.identifiers), identifiers) ||
      listsOverlap(this.parseJsonArray(row.hwids), hwids)
    ));
    return match ? this.mapPlayer(match) : null;
  }

  private findIdentifierlessPlayerBySourceOrName(sourceId: number | null | undefined, name: string): PlayerRecord | null {
    const normalizedName = this.normalizePlayerName(name);
    if (!normalizedName && sourceId === null && sourceId === undefined) return null;

    const rows = this.db.prepare('SELECT * FROM players ORDER BY last_seen_at DESC').all() as any[];
    const match = rows.find(row => {
      const player = this.mapPlayer(row);
      if (this.playerHasIdentity(player)) return false;
      if (sourceId !== null && sourceId !== undefined && player.lastSource === sourceId) return true;
      return normalizedName.length > 0 && this.normalizePlayerName(player.displayName) === normalizedName;
    });

    return match ? this.mapPlayer(match) : null;
  }

  private monitorPlayerMatchesPlayer(item: MonitorPlayerRecord, player: PlayerRecord) {
    if (item.id === player.lastSource) return true;
    if (listsOverlap(item.identifiers, player.identifiers) || listsOverlap(item.hwids, player.hwids)) return true;
    if (this.playerHasIdentity(player) || item.identifiers.length > 0 || item.hwids.length > 0) return false;
    return this.normalizePlayerName(item.name) === this.normalizePlayerName(player.displayName);
  }

  private mapPlayer(row: any): PlayerRecord {
    return {
      id: row.id,
      displayName: row.display_name,
      recentNames: this.parseJsonArray(row.recent_names),
      identifiers: this.parseJsonArray(row.identifiers),
      hwids: this.parseJsonArray(row.hwids),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastSource: row.last_source ?? null,
    };
  }

  upsertPlayerSnapshot(input: {
    sourceId?: number | null;
    name: string;
    identifiers?: string[];
    hwids?: string[];
    dropReason?: string | null;
  }) {
    const timestamp = now();
    const identifiers = cleanIdentifierList(input.identifiers);
    const hwids = cleanIdentifierList(input.hwids);
    const existing = this.findPlayerByIdentifiersOrHwids(identifiers, hwids)
      || this.findIdentifierlessPlayerBySourceOrName(input.sourceId, input.name);
    const displayName = input.name || existing?.displayName || 'Unknown Player';

    if (!existing) {
      const id = crypto.randomUUID();
      this.db.prepare(`
        INSERT INTO players (id, display_name, recent_names, identifiers, hwids, first_seen_at, last_seen_at, last_source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        displayName,
        JSON.stringify([displayName]),
        JSON.stringify(identifiers),
        JSON.stringify(hwids),
        timestamp,
        timestamp,
        input.sourceId ?? null,
        timestamp
      );

      if (input.sourceId !== undefined && input.sourceId !== null) {
        this.openPlayerSession(id, input.sourceId, identifiers, hwids, timestamp);
      }
      return this.getPlayer(id)!;
    }

    const names = Array.from(new Set([displayName, ...existing.recentNames])).slice(0, 10);
    const mergedIdentifiers = Array.from(new Set([...existing.identifiers, ...identifiers]));
    const mergedHwids = Array.from(new Set([...existing.hwids, ...hwids]));
    this.db.prepare(`
      UPDATE players
      SET display_name = ?, recent_names = ?, identifiers = ?, hwids = ?, last_seen_at = ?, last_source = ?, updated_at = ?
      WHERE id = ?
    `).run(
      displayName,
      JSON.stringify(names),
      JSON.stringify(mergedIdentifiers),
      JSON.stringify(mergedHwids),
      timestamp,
      input.sourceId ?? existing.lastSource,
      timestamp,
      existing.id
    );

    if (input.sourceId !== undefined && input.sourceId !== null) {
      this.openPlayerSession(existing.id, input.sourceId, mergedIdentifiers, mergedHwids, timestamp);
    }
    return this.getPlayer(existing.id)!;
  }

  private openPlayerSession(playerId: string, sourceId: number, identifiers: string[], hwids: string[], timestamp: string) {
    const active = this.db.prepare(`
      SELECT id FROM player_sessions
      WHERE player_id = ? AND source_id = ? AND left_at IS NULL
      LIMIT 1
    `).get(playerId, sourceId) as { id: string } | undefined;
    if (active) return;

    this.db.prepare(`
      INSERT INTO player_sessions (id, player_id, source_id, joined_at, identifiers, hwids)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), playerId, sourceId, timestamp, JSON.stringify(identifiers), JSON.stringify(hwids));
  }

  closeMissingPlayerSessions(activeSourceIds: number[]) {
    const timestamp = now();
    if (activeSourceIds.length === 0) {
      this.db.prepare('UPDATE player_sessions SET left_at = ? WHERE left_at IS NULL').run(timestamp);
      return;
    }

    const placeholders = activeSourceIds.map(() => '?').join(',');
    this.db.prepare(`UPDATE player_sessions SET left_at = ? WHERE left_at IS NULL AND source_id NOT IN (${placeholders})`)
      .run(timestamp, ...activeSourceIds);
  }

  closePlayerSession(sourceId: number, reason: string | null) {
    this.db.prepare(`
      UPDATE player_sessions SET left_at = ?, drop_reason = ?
      WHERE source_id = ? AND left_at IS NULL
    `).run(now(), reason, sourceId);
  }

  upsertMonitorPlayers(players: MonitorPlayerRecord[]) {
    const timestamp = now();
    const sync = this.db.transaction(() => {
      const seen = new Set<number>();
      const upsert = this.db.prepare(`
        INSERT INTO monitor_players (id, name, ping, identifiers, hwids, endpoint, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          ping = excluded.ping,
          identifiers = excluded.identifiers,
          hwids = excluded.hwids,
          endpoint = excluded.endpoint,
          updated_at = excluded.updated_at
      `);

      players.forEach(player => {
        seen.add(player.id);
        this.upsertPlayerSnapshot({
          sourceId: player.id,
          name: player.name,
          identifiers: player.identifiers,
          hwids: player.hwids,
        });
        upsert.run(
          player.id,
          player.name,
          player.ping || 0,
          JSON.stringify(player.identifiers || []),
          JSON.stringify(player.hwids || []),
          player.endpoint || null,
          timestamp
        );
      });

      if (seen.size > 0) {
        const placeholders = Array.from(seen).map(() => '?').join(',');
        this.db.prepare(`DELETE FROM monitor_players WHERE id NOT IN (${placeholders})`).run(...seen);
      } else {
        this.db.prepare('DELETE FROM monitor_players').run();
      }
    });

    sync();
    this.closeMissingPlayerSessions(players.map(player => player.id));
    return this.listMonitorPlayers();
  }

  listMonitorPlayers(): MonitorPlayerRecord[] {
    const rows = this.db.prepare(`
      SELECT id, name, ping, identifiers, hwids, endpoint, updated_at as updatedAt
      FROM monitor_players
      ORDER BY id ASC
    `).all() as any[];

    return rows.map(row => ({
      ...row,
      identifiers: row.identifiers ? JSON.parse(row.identifiers) : [],
      hwids: row.hwids ? JSON.parse(row.hwids) : [],
    }));
  }

  logMonitorEvent(input: {
    eventName: string;
    direction: 'inbound' | 'outbound';
    status: string;
    payload?: unknown;
  }) {
    this.db.prepare(`
      INSERT INTO monitor_events (id, timestamp, event_name, direction, status, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      now(),
      input.eventName,
      input.direction,
      input.status,
      input.payload === undefined ? null : JSON.stringify(input.payload)
    );
  }

  recentMonitorEvents(limit = 100) {
    return this.db.prepare(`
      SELECT id, timestamp, event_name as eventName, direction, status, payload
      FROM monitor_events
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit).map((row: any) => ({
      ...row,
      payload: row.payload ? JSON.parse(row.payload) : null,
    }));
  }

  getPlayer(id: string): PlayerRecord | null {
    const row = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as any;
    return row ? this.mapPlayer(row) : null;
  }

  getPlayerBySource(sourceId: number) {
    const monitor = this.db.prepare('SELECT name, identifiers, hwids FROM monitor_players WHERE id = ?').get(sourceId) as any;
    if (!monitor) return null;
    return this.findPlayerByIdentifiersOrHwids(this.parseJsonArray(monitor.identifiers), this.parseJsonArray(monitor.hwids))
      || this.findIdentifierlessPlayerBySourceOrName(sourceId, monitor.name);
  }

  searchPlayers(query = '', limit = 100) {
    const normalized = query.trim().toLowerCase();
    const rows = this.db.prepare('SELECT * FROM players ORDER BY last_seen_at DESC LIMIT ?').all(250) as any[];
    const online = this.listMonitorPlayers();

    return rows
      .map(row => {
        const player = this.mapPlayer(row);
        const onlinePlayer = online.find(item => this.monitorPlayerMatchesPlayer(item, player));
        const actions = this.db.prepare('SELECT type, revoked_at as revokedAt, expires_at as expiresAt FROM moderation_actions WHERE player_id = ? ORDER BY created_at DESC').all(player.id) as any[];
        return {
          ...player,
          online: Boolean(onlinePlayer),
          sourceId: onlinePlayer?.id ?? null,
          ping: onlinePlayer?.ping ?? null,
          actionCounts: {
            bans: actions.filter(action => action.type === 'ban').length,
            activeBans: actions.filter(action => action.type === 'ban' && !action.revokedAt && (!action.expiresAt || new Date(action.expiresAt).getTime() > Date.now())).length,
            warnings: actions.filter(action => action.type === 'warn').length,
            kicks: actions.filter(action => action.type === 'kick').length,
          },
        };
      })
      .filter(player => {
        if (!normalized) return true;
        const haystack = [
          player.id,
          player.displayName,
          ...player.recentNames,
          ...player.identifiers,
          ...player.hwids,
          String(player.sourceId || ''),
        ].join(' ').toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, limit);
  }

  getPlayerProfile(id: string) {
    const player = this.getPlayer(id);
    if (!player) return null;
    const online = this.listMonitorPlayers().find(item => this.monitorPlayerMatchesPlayer(item, player));

    const sessions = this.db.prepare(`
      SELECT id, source_id as sourceId, joined_at as joinedAt, left_at as leftAt, drop_reason as dropReason, identifiers, hwids
      FROM player_sessions
      WHERE player_id = ?
      ORDER BY joined_at DESC
      LIMIT 25
    `).all(id).map((row: any) => ({
      ...row,
      identifiers: this.parseJsonArray(row.identifiers),
      hwids: this.parseJsonArray(row.hwids),
    }));

    return {
      ...player,
      online: Boolean(online),
      sourceId: online?.id ?? null,
      ping: online?.ping ?? null,
      sessions,
      notes: this.listPlayerNotes(id),
      actions: this.listPlayerActions(id),
    };
  }

  private mapAction(row: any) {
    return {
      id: row.id,
      type: row.type,
      playerId: row.player_id,
      targetName: row.target_name,
      targetIdentifiers: this.parseJsonArray(row.target_identifiers),
      targetHwids: this.parseJsonArray(row.target_hwids),
      reason: row.reason,
      durationInput: row.duration_input,
      expiresAt: row.expires_at,
      authorAdminId: row.author_admin_id,
      authorUsername: row.author_username,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      revokedByAdminId: row.revoked_by_admin_id,
      revokedByUsername: row.revoked_by_username,
      revocationReason: row.revocation_reason,
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBySource: row.acknowledged_by_source,
      acknowledgementMetadata: row.acknowledgement_metadata ? JSON.parse(row.acknowledgement_metadata) : null,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  listPlayerActions(playerId: string) {
    return this.db.prepare(`
      SELECT * FROM moderation_actions
      WHERE player_id = ?
      ORDER BY created_at DESC
    `).all(playerId).map(row => this.mapAction(row));
  }

  listBanActions(input?: {
    status?: 'active' | 'expired' | 'revoked' | 'all';
    query?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
    const offset = Math.max(input?.offset ?? 0, 0);
    const status = input?.status || 'all';
    const query = (input?.query || '').trim().toLowerCase();
    const timestamp = now();

    const statusClause = status === 'active'
      ? 'AND ma.revoked_at IS NULL AND (ma.expires_at IS NULL OR ma.expires_at > ?)'
      : status === 'expired'
        ? 'AND ma.revoked_at IS NULL AND ma.expires_at IS NOT NULL AND ma.expires_at <= ?'
        : status === 'revoked'
          ? 'AND ma.revoked_at IS NOT NULL'
          : '';

    const statusParams = status === 'active' || status === 'expired' ? [timestamp] : [];

    const rows = this.db.prepare(`
      SELECT ma.*, p.display_name as playerDisplayName
      FROM moderation_actions ma
      LEFT JOIN players p ON p.id = ma.player_id
      WHERE ma.type = 'ban'
      ${statusClause}
      ORDER BY ma.created_at DESC
      LIMIT ?
      OFFSET ?
    `).all(...statusParams, limit + (query ? 500 : 0), offset) as any[];

    const mapped = rows.map(row => ({
      ...this.mapAction(row),
      playerDisplayName: row.playerDisplayName || row.target_name || 'Unknown player',
    }));

    if (!query) {
      return mapped.slice(0, limit);
    }

    return mapped.filter(ban => {
      const haystack = [
        ban.playerDisplayName,
        ban.targetName,
        ban.reason,
        ban.authorUsername,
        ...ban.targetIdentifiers,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    }).slice(0, limit);
  }

  getActiveBanForPlayer(playerId: string) {
    const row = this.db.prepare(`
      SELECT * FROM moderation_actions
      WHERE player_id = ?
        AND type = 'ban'
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
      LIMIT 1
    `).get(playerId, now()) as any;

    return row ? this.mapAction(row) : null;
  }

  createModerationAction(input: {
    type: 'ban' | 'warn' | 'kick' | 'dm' | 'note';
    playerId?: string | null;
    targetName?: string | null;
    targetIdentifiers?: string[];
    targetHwids?: string[];
    reason?: string | null;
    durationInput?: string | null;
    authorAdminId?: string | null;
    authorUsername?: string | null;
    metadata?: unknown;
  }) {
    const id = crypto.randomUUID();
    const player = input.playerId ? this.getPlayer(input.playerId) : null;
    const targetIdentifiers = cleanIdentifierList(input.targetIdentifiers?.length ? input.targetIdentifiers : player?.identifiers);
    const targetHwids = cleanIdentifierList(input.targetHwids?.length ? input.targetHwids : player?.hwids);
    const durationInput = input.durationInput || null;
    const expiresAt = input.type === 'ban' ? parseDurationToExpiration(durationInput) : null;

    this.db.prepare(`
      INSERT INTO moderation_actions (
        id, type, player_id, target_name, target_identifiers, target_hwids, reason, duration_input, expires_at,
        author_admin_id, author_username, created_at, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.playerId || null,
      input.targetName || player?.displayName || null,
      JSON.stringify(targetIdentifiers),
      JSON.stringify(targetHwids),
      input.reason || null,
      durationInput,
      expiresAt,
      input.authorAdminId || null,
      input.authorUsername || null,
      now(),
      input.metadata === undefined ? null : JSON.stringify(input.metadata)
    );

    return this.getModerationAction(id)!;
  }

  getModerationAction(id: string) {
    const row = this.db.prepare('SELECT * FROM moderation_actions WHERE id = ?').get(id) as any;
    return row ? this.mapAction(row) : null;
  }

  revokeModerationAction(id: string, actorAdminId: string | null, actorUsername: string | null, reason: string | null) {
    this.db.prepare(`
      UPDATE moderation_actions
      SET revoked_at = ?, revoked_by_admin_id = ?, revoked_by_username = ?, revocation_reason = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(now(), actorAdminId, actorUsername, reason, id);
    return this.getModerationAction(id);
  }

  acknowledgeWarning(id: string, sourceId: number | null, metadata?: unknown) {
    const warning = this.db.prepare("SELECT id FROM moderation_actions WHERE id = ? AND type = 'warn'").get(id);
    if (!warning) return null;

    this.db.prepare(`
      UPDATE moderation_actions
      SET acknowledged_at = ?, acknowledged_by_source = ?, acknowledgement_metadata = ?
      WHERE id = ? AND type = 'warn' AND acknowledged_at IS NULL
    `).run(
      now(),
      sourceId,
      metadata === undefined ? null : JSON.stringify(metadata),
      id
    );
    return this.getModerationAction(id);
  }

  listPlayerNotes(playerId: string) {
    return this.db.prepare(`
      SELECT id, player_id as playerId, note, author_admin_id as authorAdminId, author_username as authorUsername,
        created_at as createdAt, updated_at as updatedAt
      FROM player_notes
      WHERE player_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `).all(playerId);
  }

  createPlayerNote(playerId: string, note: string, actorAdminId: string | null, actorUsername: string | null) {
    const id = crypto.randomUUID();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO player_notes (id, player_id, note, author_admin_id, author_username, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, playerId, note, actorAdminId, actorUsername, timestamp, timestamp);
    this.createModerationAction({ type: 'note', playerId, reason: note, authorAdminId: actorAdminId, authorUsername: actorUsername });
    return this.listPlayerNotes(playerId).find((item: any) => item.id === id);
  }

  updatePlayerNote(noteId: string, note: string) {
    this.db.prepare('UPDATE player_notes SET note = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(note, now(), noteId);
    const row = this.db.prepare(`
      SELECT id, player_id as playerId, note, author_admin_id as authorAdminId, author_username as authorUsername,
        created_at as createdAt, updated_at as updatedAt
      FROM player_notes WHERE id = ? AND deleted_at IS NULL
    `).get(noteId);
    return row || null;
  }

  deletePlayerNote(noteId: string) {
    const row = this.db.prepare('SELECT player_id as playerId FROM player_notes WHERE id = ? AND deleted_at IS NULL').get(noteId) as any;
    if (!row) return null;
    this.db.prepare('UPDATE player_notes SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), noteId);
    return row.playerId as string;
  }

  checkJoin(input: { name: string; identifiers?: string[]; hwids?: string[]; sourceId?: number | null; discordId?: string | null }) {
    const identifiers = cleanIdentifierList(input.identifiers);
    const hwids = cleanIdentifierList(input.hwids);
    const player = this.upsertPlayerSnapshot({
      sourceId: input.sourceId ?? null,
      name: input.name || 'Connecting Player',
      identifiers,
      hwids,
    });
    const actions = this.db.prepare(`
      SELECT * FROM moderation_actions
      WHERE type = 'ban' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
    `).all(now()).map(row => this.mapAction(row));

    const ban = actions.find(action => (
      listsOverlap(action.targetIdentifiers, identifiers) ||
      listsOverlap(action.targetHwids, hwids)
    ));

    if (ban) return {
      allow: false,
      player,
      action: ban,
      reason: `Banned from this server: ${ban.reason || 'No reason provided'}`,
      decision: 'banned',
    };

    const whitelistMode = this.getWhitelistMode();
    if (whitelistMode === 'disabled') return { allow: true, player, decision: 'whitelist_disabled' };

    const whitelisted = this.whitelistAllows(player, identifiers, input.discordId);
    if (whitelisted) return { allow: true, player, decision: 'whitelisted' };

    const reason = 'This server is whitelisted. Submit a whitelist request or contact staff.';
    if (whitelistMode === 'dry-run') return { allow: true, player, reason, decision: 'whitelist_dry_run' };
    return {
      allow: false,
      player,
      reason,
      decision: 'whitelist_denied',
    };
  }

  listBanTemplates() {
    return this.db.prepare(`
      SELECT id, name, reason, duration, created_at as createdAt, updated_at as updatedAt
      FROM ban_templates
      ORDER BY name ASC
    `).all();
  }

  createBanTemplate(name: string, reason: string, duration: string) {
    const id = crypto.randomUUID();
    const timestamp = now();
    this.db.prepare('INSERT INTO ban_templates (id, name, reason, duration, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, reason, duration || 'permanent', timestamp, timestamp);
    return this.listBanTemplates().find((template: any) => template.id === id);
  }

  updateBanTemplate(id: string, name: string, reason: string, duration: string) {
    this.db.prepare('UPDATE ban_templates SET name = ?, reason = ?, duration = ?, updated_at = ? WHERE id = ?')
      .run(name, reason, duration || 'permanent', now(), id);
    return this.listBanTemplates().find((template: any) => template.id === id) || null;
  }

  deleteBanTemplate(id: string) {
    const result = this.db.prepare('DELETE FROM ban_templates WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
