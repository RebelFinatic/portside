import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import crypto from 'crypto';
import { ALL_PERMISSIONS, normalizePermissions } from './permissions';
import { cleanIdentifierList, listsOverlap, parseDurationToExpiration } from './moderation';

const now = () => new Date().toISOString();

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
  enabled: boolean;
  isOwner: boolean;
}

export interface SessionRecord {
  id: string;
  adminId: string;
  expiresAt: string;
  revokedAt: string | null;
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

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
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

  getRolePermissions(roleId: string) {
    const rows = this.db.prepare('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission').all(roleId) as { permission: string }[];
    return rows.map(row => row.permission);
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

  private findPlayerByIdentifiersOrHwids(identifiers: string[], hwids: string[]): PlayerRecord | null {
    const rows = this.db.prepare('SELECT * FROM players').all() as any[];
    const match = rows.find(row => (
      listsOverlap(this.parseJsonArray(row.identifiers), identifiers) ||
      listsOverlap(this.parseJsonArray(row.hwids), hwids)
    ));
    return match ? this.mapPlayer(match) : null;
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
    const existing = this.findPlayerByIdentifiersOrHwids(identifiers, hwids);
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
    return this.findPlayerByIdentifiersOrHwids(this.parseJsonArray(monitor.identifiers), this.parseJsonArray(monitor.hwids));
  }

  searchPlayers(query = '', limit = 100) {
    const normalized = query.trim().toLowerCase();
    const rows = this.db.prepare('SELECT * FROM players ORDER BY last_seen_at DESC LIMIT ?').all(250) as any[];
    const online = this.listMonitorPlayers();

    return rows
      .map(row => {
        const player = this.mapPlayer(row);
        const onlinePlayer = online.find(item => (
          item.id === player.lastSource ||
          listsOverlap(item.identifiers, player.identifiers) ||
          listsOverlap(item.hwids, player.hwids)
        ));
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
    const online = this.listMonitorPlayers().find(item => (
      item.id === player.lastSource ||
      listsOverlap(item.identifiers, player.identifiers) ||
      listsOverlap(item.hwids, player.hwids)
    ));

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

  checkJoin(input: { name: string; identifiers?: string[]; hwids?: string[]; sourceId?: number | null }) {
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

    if (!ban) return { allow: true, player };
    return {
      allow: false,
      player,
      action: ban,
      reason: `Banned from this server: ${ban.reason || 'No reason provided'}`,
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
