import type { Express, Response } from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { PERMISSIONS } from './permissions';
import type { PortsideStore } from './store';
import type { MemoryLogger } from './logging';
import type { AuthedRequest } from './types';
import {
  assertSafeResourceName,
  createRconRunner,
  fetchFiveMJson,
  readServerConfig,
  writeServerConfig,
} from './fivem';
import { MONITOR_VERSION, createMonitorEventRelay, requireMonitorToken, safeEventName } from './monitor';
import type { RealtimeHub } from './realtime';
import {
  createAuthMiddleware,
  createOwner,
  login,
  logout,
  requirePermission,
  sanitizeUser,
} from './auth';

const configFiles = ['server.cfg'];

const mockResources = [
  { name: 'es_extended', state: 'started', version: '1.8.5', author: 'ESX', description: 'The core ESX server framework.', dependencies: ['mysql-async'], logs: 'es_extended: Loaded successfully.' },
  { name: 'qs-inventory', state: 'started', version: '2.1.0', author: 'Quasar', description: 'Advanced inventory system with drag & drop.', dependencies: ['es_extended'], logs: 'qs-inventory: Connected to DB.' },
  { name: 'custom-cars', state: 'stopped', version: '1.0.0', author: 'Admin', description: 'Custom vehicle pack.', dependencies: ['vMenu'], logs: 'custom-cars: Initialized 12 vehicles.' },
  { name: 'vMenu', state: 'started', version: '3.5.0', author: 'Vesura', description: 'Server sidemenu for players and admins.', dependencies: [], logs: 'vMenu: Permissions loaded.' },
];

const actionActor = (req: AuthedRequest) => ({
  actorAdminId: req.user?.id,
  actorUsername: req.user?.username,
  ip: req.ip,
});

export const registerApiRoutes = (app: Express, store: PortsideStore, logger: MemoryLogger, realtime: RealtimeHub) => {
  const authenticateToken = createAuthMiddleware(store);
  const runRconCommand = createRconRunner(logger);
  const relayMonitorEvent = createMonitorEventRelay(store, logger, runRconCommand);

  let dbPool: mysql.Pool | null = null;
  try {
    if (process.env.DB_HOST && process.env.DB_USER) {
      dbPool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'fivem',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
      logger.add('INFO', 'Database pool created successfully', 'database');
    } else {
      logger.add('WARN', 'Database credentials not provided, running in mock DB mode', 'database');
    }
  } catch (error: any) {
    logger.add('ERROR', `Database connection failed: ${error.message}`, 'database');
  }

  app.post('/api/monitor/heartbeat', requireMonitorToken, (req, res) => {
    const status = store.upsertMonitorHeartbeat({
      resourceName: typeof req.body?.resourceName === 'string' ? req.body.resourceName : 'portside_monitor',
      version: typeof req.body?.version === 'string' ? req.body.version : MONITOR_VERSION,
      gameName: typeof req.body?.gameName === 'string' ? req.body.gameName : null,
      serverName: typeof req.body?.serverName === 'string' ? req.body.serverName : null,
      players: Number.isFinite(req.body?.players) ? Number(req.body.players) : null,
      maxPlayers: Number.isFinite(req.body?.maxPlayers) ? Number(req.body.maxPlayers) : null,
      debug: Boolean(req.body?.debug),
    });
    realtime.broadcast('status', { monitor: status });
    res.json({ ok: true, status });
  });

  app.post('/api/monitor/resources', requireMonitorToken, (req, res) => {
    const resources = Array.isArray(req.body?.resources) ? req.body.resources : [];
    const normalized = resources
      .filter((resource: any) => typeof resource?.name === 'string' && resource.name.trim())
      .map((resource: any) => ({
        name: resource.name.trim(),
        state: typeof resource.state === 'string' ? resource.state : 'unknown',
        path: typeof resource.path === 'string' ? resource.path : null,
        author: typeof resource.author === 'string' ? resource.author : null,
        version: typeof resource.version === 'string' ? resource.version : null,
        description: typeof resource.description === 'string' ? resource.description : null,
        dependencies: Array.isArray(resource.dependencies) ? resource.dependencies.filter((dep: unknown) => typeof dep === 'string') : [],
        metadata: typeof resource.metadata === 'object' && resource.metadata ? resource.metadata : null,
        updatedAt: new Date().toISOString(),
      }));

    const stored = store.upsertMonitorResources(normalized);
    store.logMonitorEvent({ eventName: 'resources.report', direction: 'inbound', status: 'success', payload: { count: stored.length } });
    realtime.broadcast('resources', stored);
    res.json({ ok: true, resources: stored.length });
  });

  app.post('/api/monitor/players', requireMonitorToken, (req, res) => {
    const players = Array.isArray(req.body?.players) ? req.body.players : [];
    const normalized = players
      .filter((player: any) => Number.isFinite(Number(player?.id)) && typeof player?.name === 'string')
      .map((player: any) => ({
        id: Number(player.id),
        name: player.name,
        ping: Number(player.ping || 0),
        identifiers: Array.isArray(player.identifiers) ? player.identifiers.filter((identifier: unknown) => typeof identifier === 'string') : [],
        endpoint: typeof player.endpoint === 'string' ? player.endpoint : null,
        updatedAt: new Date().toISOString(),
      }));

    const stored = store.upsertMonitorPlayers(normalized);
    store.logMonitorEvent({ eventName: 'players.report', direction: 'inbound', status: 'success', payload: { count: stored.length } });
    realtime.broadcast('players', stored);
    res.json({ ok: true, players: stored.length });
  });

  app.post('/api/monitor/events', requireMonitorToken, (req, res) => {
    const eventName = typeof req.body?.eventName === 'string' ? req.body.eventName : '';
    if (!safeEventName(eventName)) return res.status(400).json({ error: 'Invalid event name' });

    store.logMonitorEvent({
      eventName,
      direction: 'inbound',
      status: 'success',
      payload: req.body?.payload ?? null,
    });
    realtime.broadcast('logs', { type: 'monitor-event', eventName, payload: req.body?.payload ?? null });
    res.json({ ok: true });
  });

  app.get('/api/setup/status', (_req, res) => {
    res.json({ setupRequired: !store.hasOwner() });
  });

  app.post('/api/setup/admin', (req, res) => {
    createOwner(store, req, res).catch(error => {
      logger.add('ERROR', `Setup error: ${error.message}`, 'auth');
      res.status(500).json({ error: 'Failed to complete setup' });
    });
  });

  app.post('/api/auth/login', (req, res) => {
    login(store, req, res).catch(error => {
      logger.add('ERROR', `Login error: ${error.message}`, 'auth');
      res.status(500).json({ error: 'Internal server error' });
    });
  });

  app.post('/api/auth/logout', authenticateToken, (req: AuthedRequest, res) => logout(store, req, res));

  app.get('/api/auth/verify', authenticateToken, (req: AuthedRequest, res) => {
    res.json({ user: sanitizeUser(req.user!) });
  });

  app.get('/api/permissions', authenticateToken, requirePermission(store, 'manage.admins'), (_req, res) => {
    res.json(PERMISSIONS);
  });

  app.get('/api/server/status', authenticateToken, async (_req, res) => {
    try {
      const monitorStatus = store.getMonitorStatus();
      let players = 0;
      let maxPlayers = 64;
      let online = monitorStatus.online;

      if (monitorStatus.online) {
        players = monitorStatus.players ?? store.listMonitorPlayers().length;
        maxPlayers = monitorStatus.maxPlayers || maxPlayers;
      }

      if (monitorStatus.online) {
        online = true;
      } else if (process.env.FIVEM_SERVER_URL) {
        try {
          const fetchObj = await fetch(`${process.env.FIVEM_SERVER_URL}/info.json`);
          if (fetchObj.ok) {
            const info = await fetchObj.json();
            maxPlayers = Number(info.vars?.sv_maxClients || 64);
            online = true;
          }
          const dynObj = await fetch(`${process.env.FIVEM_SERVER_URL}/dynamic.json`);
          if (dynObj.ok) {
            const dyn = await dynObj.json();
            players = dyn.clients || 0;
          }
        } catch {
          logger.add('WARN', `Could not connect to external FiveM server at ${process.env.FIVEM_SERVER_URL}`, 'system');
        }
      } else {
        online = true;
        players = 42;
      }

      res.json({
        online,
        players,
        maxPlayers,
        cpuUsage: Math.floor(Math.random() * 40) + 10,
        memoryUsage: Math.floor(Math.random() * 60) + 30,
        uptime: '14h 22m',
        monitor: monitorStatus,
      });
    } catch (err: any) {
      logger.add('ERROR', `Could not fetch server status: ${err.message}`, 'system');
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

  app.get('/api/players', authenticateToken, async (_req, res) => {
    try {
      const monitorStatus = store.getMonitorStatus();
      const monitorPlayers = store.listMonitorPlayers();
      if (monitorStatus.online && monitorPlayers.length > 0) {
        return res.json(monitorPlayers.map(player => ({
          id: player.id,
          name: player.name,
          ping: player.ping || 0,
          identifiers: player.identifiers || [],
          role: 'player',
          source: 'monitor',
        })));
      }

      if (!process.env.FIVEM_SERVER_URL) {
        return res.json([
          { id: 1, name: 'thevindu', ping: 42, identifiers: ['steam:11000010abc1234'], role: 'owner' },
          { id: 2, name: 'john_doe', ping: 120, identifiers: ['steam:1100001bcdef987'], role: 'player' },
          { id: 4, name: 'gamer99', ping: 15, identifiers: ['steam:110000155555555'], role: 'admin' },
        ]);
      }

      const players = await fetchFiveMJson('/players.json');
      res.json(players.map((player: any) => ({
        id: player.id,
        name: player.name,
        ping: player.ping || 0,
        identifiers: player.identifiers || [],
        role: 'player',
      })));
    } catch (err: any) {
      logger.add('ERROR', `Could not fetch FiveM players: ${err.message}`, 'system');
      res.status(502).json({ error: 'Failed to fetch FiveM players' });
    }
  });

  app.post('/api/players/:id/kick', authenticateToken, requirePermission(store, 'players.kick'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : 'Kicked by Portside';

      if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid player id' });

      await runRconCommand(`clientkick ${id} ${reason}`);
      store.logAction({ ...actionActor(req), action: 'players.kick', method: req.method, route: req.originalUrl, permission: 'players.kick', status: 'success', details: { id, reason } });
      relayMonitorEvent('playerKicked', {
        target: Number(id),
        author: req.user?.username || 'Portside',
        reason,
        dropMessage: reason,
      });
      res.json({ success: true, message: `Player ${id} kicked successfully` });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Failed to kick player' });
    }
  });

  app.post('/api/players/:id/ban', authenticateToken, requirePermission(store, 'players.ban'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { reason = 'Banned by Portside', duration = 'permanent' } = req.body || {};

      if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid player id' });

      if (!process.env.FIVEM_RCON_BAN_COMMAND) {
        return res.status(501).json({ error: 'Ban command is not configured. Set FIVEM_RCON_BAN_COMMAND for your framework.' });
      }

      const command = process.env.FIVEM_RCON_BAN_COMMAND
        .replaceAll('{id}', id)
        .replaceAll('{reason}', String(reason).trim())
        .replaceAll('{duration}', String(duration).trim());

      await runRconCommand(command);
      store.logAction({ ...actionActor(req), action: 'players.ban', method: req.method, route: req.originalUrl, permission: 'players.ban', status: 'success', details: { id, reason, duration } });
      res.json({ success: true, message: `Player ${id} banned successfully` });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Failed to ban player' });
    }
  });

  app.get('/api/logs', authenticateToken, requirePermission(store, 'txadmin.log.view'), (_req, res) => {
    res.json(logger.recent());
  });

  app.get('/api/admin-logs', authenticateToken, requirePermission(store, 'txadmin.log.view'), (_req, res) => {
    res.json(store.recentActionLogs());
  });

  app.get('/api/monitor/status', authenticateToken, (_req, res) => {
    res.json({
      ...store.getMonitorStatus(),
      recentEvents: store.recentMonitorEvents(20),
    });
  });

  app.post('/api/announcement', authenticateToken, requirePermission(store, 'announcement'), async (req: AuthedRequest, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'Announcement message is required' });

    const relayed = await relayMonitorEvent('announcement', {
      author: req.user?.username || 'Portside',
      message,
    });
    store.logAction({ ...actionActor(req), action: 'announcement.send', method: req.method, route: req.originalUrl, permission: 'announcement', status: relayed ? 'success' : 'failed', details: { message } });
    res.json({ success: relayed });
  });

  app.post('/api/console/command', authenticateToken, requirePermission(store, 'console.write'), async (req: AuthedRequest, res) => {
    try {
      const { command } = req.body;
      if (typeof command !== 'string' || !command.trim()) return res.status(400).json({ error: 'Command required' });

      const output = await runRconCommand(command.trim());
      store.logAction({ ...actionActor(req), action: 'console.command', method: req.method, route: req.originalUrl, permission: 'console.write', status: 'success', details: { command: command.trim() } });
      relayMonitorEvent('consoleCommand', {
        author: req.user?.username || 'Portside',
        command: command.trim(),
      });
      realtime.broadcast('logs', logger.recent(20));
      res.json({ success: true, output });
    } catch (err: any) {
      logger.add('ERROR', `RCON command failed: ${err.message}`, 'rcon');
      res.status(502).json({ error: err.message || 'RCON command failed' });
    }
  });

  app.get('/api/db/tables', authenticateToken, requirePermission(store, 'database.read'), async (_req, res) => {
    if (!dbPool) {
      if (process.env.DEBUG === 'true' || process.env.VITE_DEBUG === 'true') {
        return res.json({ tables: ['users', 'owned_vehicles', 'characters', 'addon_inventory', 'datastore', 'datastore_data'] });
      }
      return res.status(503).json({ error: 'Database not connected' });
    }

    try {
      const [rows] = await dbPool.query('SHOW TABLES');
      res.json({ tables: (rows as any[]).map(row => Object.values(row)[0]) });
    } catch (err: any) {
      logger.add('ERROR', `DB Query failed: ${err.message}`, 'database');
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/db/query', authenticateToken, requirePermission(store, 'database.write'), async (req: AuthedRequest, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    if (!dbPool) {
      if (process.env.DEBUG === 'true' || process.env.VITE_DEBUG === 'true') {
        logger.add('INFO', `Mock Executed Query: ${query}`, 'database');
        store.logAction({ ...actionActor(req), action: 'database.query', method: req.method, route: req.originalUrl, permission: 'database.write', status: 'success', details: { mock: true } });
        return res.json({
          success: true,
          columns: ['id', 'identifier', 'group', 'money', 'bank'],
          rows: [
            { id: 1, identifier: 'steam:1100001bcdef987', group: 'superadmin', money: 500, bank: 150000 },
            { id: 2, identifier: 'license:123456789abc', group: 'user', money: 200, bank: 500 },
          ],
        });
      }
      return res.status(503).json({ error: 'Database not connected' });
    }

    try {
      logger.add('INFO', `Executed Query: ${query}`, 'database');
      const [rows, fields] = await dbPool.query(query);
      store.logAction({ ...actionActor(req), action: 'database.query', method: req.method, route: req.originalUrl, permission: 'database.write', status: 'success' });
      if (Array.isArray(rows)) {
        res.json({ success: true, columns: fields ? fields.map((field: any) => field.name) : [], rows });
      } else {
        res.json({ success: true, affectedRows: (rows as any).affectedRows, message: 'Query executed successfully' });
      }
    } catch (err: any) {
      logger.add('ERROR', `DB Query failed: ${err.message}`, 'database');
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/resources', authenticateToken, requirePermission(store, 'commands.resources'), async (_req, res) => {
    try {
      const monitorStatus = store.getMonitorStatus();
      const monitorResources = store.listMonitorResources();
      if (monitorStatus.online && monitorResources.length > 0) {
        return res.json(monitorResources.map(resource => ({
          name: resource.name,
          state: resource.state,
          path: resource.path,
          version: resource.version || undefined,
          author: resource.author || undefined,
          description: resource.description || 'Live resource reported by portside_monitor.',
          dependencies: resource.dependencies,
          metadata: resource.metadata,
          logs: `${resource.name}: reported by portside_monitor`,
          source: 'monitor',
          updatedAt: resource.updatedAt,
        })));
      }

      if (!process.env.FIVEM_SERVER_URL) return res.json(mockResources);

      const info = await fetchFiveMJson('/info.json');
      const resources = Array.isArray(info.resources) ? info.resources : [];
      res.json(resources.map((name: string) => ({
        name,
        state: 'started',
        version: undefined,
        author: undefined,
        description: 'Live resource reported by the FiveM server manifest.',
        dependencies: [],
        logs: `${name}: reported by ${process.env.FIVEM_SERVER_URL}/info.json`,
      })));
    } catch (err: any) {
      logger.add('ERROR', `Could not fetch FiveM resources: ${err.message}`, 'system');
      res.status(502).json({ error: 'Failed to fetch FiveM resources' });
    }
  });

  const resourceAction = (action: 'start' | 'stop' | 'restart') => async (req: AuthedRequest, res: Response) => {
    try {
      const { name } = req.params;
      assertSafeResourceName(name);
      await runRconCommand(`${action} ${name}`);
      store.logAction({ ...actionActor(req), action: `resources.${action}`, method: req.method, route: req.originalUrl, permission: 'commands.resources', status: 'success', details: { name } });
      const latestMonitorResources = store.listMonitorResources();
      if (latestMonitorResources.length > 0) realtime.broadcast('resources', latestMonitorResources);
      res.json({ success: true, resource: { name, state: action === 'stop' ? 'stopped' : 'started' } });
    } catch (err: any) {
      res.status(502).json({ error: err.message || `Failed to ${action} resource` });
    }
  };

  app.post('/api/resources/:name/start', authenticateToken, requirePermission(store, 'commands.resources'), resourceAction('start'));
  app.post('/api/resources/:name/stop', authenticateToken, requirePermission(store, 'commands.resources'), resourceAction('stop'));
  app.post('/api/resources/:name/restart', authenticateToken, requirePermission(store, 'commands.resources'), resourceAction('restart'));

  app.get('/api/config', authenticateToken, requirePermission(store, 'server.cfg.editor'), async (req, res) => {
    const file = req.query.file as string;
    if (!file) return res.json({ files: configFiles });
    if (file !== 'server.cfg') return res.status(404).json({ error: 'Config not found' });

    try {
      res.json(await readServerConfig());
    } catch (err: any) {
      const status = err.code === 'ENOENT' ? 404 : err.message.includes('not configured') ? 503 : 500;
      logger.add('ERROR', `Could not read server.cfg: ${err.message}`, 'system');
      res.status(status).json({ error: err.message || 'Failed to read server.cfg' });
    }
  });

  app.put('/api/config', authenticateToken, requirePermission(store, 'server.cfg.editor'), async (req: AuthedRequest, res) => {
    const file = req.query.file as string;
    const { content } = req.body;

    if (file !== 'server.cfg') return res.status(404).json({ error: 'Config not found' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'Invalid config payload' });

    try {
      const configPath = await writeServerConfig(content);
      logger.add('INFO', 'Configuration updated: server.cfg', 'system');
      store.logAction({ ...actionActor(req), action: 'config.update', method: req.method, route: req.originalUrl, permission: 'server.cfg.editor', status: 'success', details: { file } });
      relayMonitorEvent('configChanged', {
        author: req.user?.username || 'Portside',
        file,
      });
      realtime.broadcast('logs', logger.recent(20));
      res.json({ success: true, path: configPath });
    } catch (err: any) {
      const status = err.code === 'ENOENT' ? 404 : err.message.includes('not configured') ? 503 : 500;
      logger.add('ERROR', `Could not write server.cfg: ${err.message}`, 'system');
      res.status(status).json({ error: err.message || 'Failed to write server.cfg' });
    }
  });

  app.get('/api/roles', authenticateToken, requirePermission(store, 'manage.admins'), (_req, res) => {
    res.json(store.listRoles());
  });

  app.post('/api/roles', authenticateToken, requirePermission(store, 'manage.admins'), (req: AuthedRequest, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'Role name is required' });
      const role = store.createRole(name, req.body?.permissions || []);
      store.logAction({ ...actionActor(req), action: 'roles.create', method: req.method, route: req.originalUrl, permission: 'manage.admins', status: 'success', details: { roleId: role.id, name } });
      res.json(role);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create role' });
    }
  });

  app.put('/api/roles/:id', authenticateToken, requirePermission(store, 'manage.admins'), (req: AuthedRequest, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'Role name is required' });
      const role = store.updateRole(req.params.id, name, req.body?.permissions || []);
      if (!role) return res.status(404).json({ error: 'Role not found' });
      store.logAction({ ...actionActor(req), action: 'roles.update', method: req.method, route: req.originalUrl, permission: 'manage.admins', status: 'success', details: { roleId: role.id, name } });
      res.json(role);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to update role' });
    }
  });

  app.delete('/api/roles/:id', authenticateToken, requirePermission(store, 'manage.admins'), (req: AuthedRequest, res) => {
    try {
      const deleted = store.deleteRole(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Role not found or cannot be deleted' });
      store.logAction({ ...actionActor(req), action: 'roles.delete', method: req.method, route: req.originalUrl, permission: 'manage.admins', status: 'success', details: { roleId: req.params.id } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to delete role' });
    }
  });

  app.get('/api/platform-users', authenticateToken, requirePermission(store, 'manage.admins'), (_req, res) => {
    res.json(store.listAdmins());
  });

  app.post('/api/platform-users', authenticateToken, requirePermission(store, 'manage.admins'), async (req: AuthedRequest, res) => {
    try {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const roleId = typeof req.body?.roleId === 'string' ? req.body.roleId : '';

      if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be 3-40 characters and use letters, numbers, dot, dash, or underscore' });
      }
      if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
      if (!roleId) return res.status(400).json({ error: 'Role is required' });

      const passwordHash = await bcrypt.hash(password, 12);
      const admin = store.createAdmin(username, passwordHash, roleId);
      store.logAction({ ...actionActor(req), action: 'admins.create', method: req.method, route: req.originalUrl, permission: 'manage.admins', status: 'success', details: { adminId: admin.id, username, roleId } });
      res.status(201).json(admin);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create admin' });
    }
  });

  app.put('/api/platform-users/:id/role', authenticateToken, requirePermission(store, 'manage.admins'), (req: AuthedRequest, res) => {
    try {
      const user = store.assignAdminRole(req.params.id, req.body?.roleId);
      if (!user) return res.status(404).json({ error: 'User or role not found' });
      store.logAction({ ...actionActor(req), action: 'admins.assign_role', method: req.method, route: req.originalUrl, permission: 'manage.admins', status: 'success', details: { adminId: req.params.id, roleId: req.body?.roleId } });
      res.json(user);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to update user role' });
    }
  });
};
