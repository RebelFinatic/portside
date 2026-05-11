import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import crypto from 'crypto';
import { ALL_PERMISSIONS, normalizePermissions } from './permissions';

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
    `);
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
}
