import type { Express, Response } from 'express';
import path from 'path';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { PERMISSIONS } from './permissions';
import type { PortsideStore } from './store';
import type { LogFamily, MemoryLogger } from './logging';
import type { AuthedRequest } from './types';
import { sampleRuntimeMetrics } from './metrics';
import {
  assertSafeResourceName,
  createRconRunner,
  fetchFiveMJson,
  readServerConfig,
  writeServerConfig,
} from './fivem';
import { MONITOR_VERSION, createMonitorEventRelay, requireMonitorToken, safeEventName } from './monitor';
import { cleanIdentifierList } from './moderation';
import type { RealtimeHub } from './realtime';
import type { FxServerManager } from './fxserver';
import type { DiscordStatusService } from './discord';
import { nextOccurrenceForSchedule } from './scheduler';
import { collectDiagnostics, collectDiagnosticsBundle } from './diagnostics';
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

const mockPlayers = [
  { id: 1, name: 'thevindu', ping: 42, identifiers: ['steam:11000010abc1234'], hwids: [], role: 'owner' },
  { id: 2, name: 'john_doe', ping: 120, identifiers: ['steam:1100001bcdef987'], hwids: [], role: 'player' },
  { id: 4, name: 'gamer99', ping: 15, identifiers: ['steam:110000155555555'], hwids: [], role: 'admin' },
];

const actionActor = (req: AuthedRequest) => ({
  actorAdminId: req.user?.id,
  actorUsername: req.user?.username,
  ip: req.ip,
});

const logFamily = (value: unknown): LogFamily | undefined => (
  value === 'admin' || value === 'fxserver' || value === 'server' ? value : undefined
);

const hasPermissionName = (req: AuthedRequest, permission: string) => {
  const permissions = req.user?.permissions || [];
  return permissions.includes('all_permissions') || permissions.includes(permission);
};

const hasHostToken = (req: AuthedRequest) => {
  const expected = process.env.PORTSIDE_HOST_API_TOKEN || process.env.TXHOST_API_TOKEN;
  if (!expected) return false;
  const supplied = req.header('x-portside-envtoken') || req.header('x-txadmin-envtoken') || (typeof req.query.token === 'string' ? req.query.token : '');
  return supplied === expected;
};

type RelayMonitorEvent = (eventName: string, payload: Record<string, unknown>) => Promise<boolean>;

export const registerApiRoutes = (
  app: Express,
  store: PortsideStore,
  logger: MemoryLogger,
  realtime: RealtimeHub,
  fxServer: FxServerManager,
  relayMonitorEventOverride?: RelayMonitorEvent,
  discordStatus?: DiscordStatusService
) => {
  const authenticateToken = createAuthMiddleware(store);
  const runRconCommand = createRconRunner(logger);
  const relayMonitorEvent = relayMonitorEventOverride || createMonitorEventRelay(store, logger, runRconCommand);

  const listOnlinePlayers = async () => {
    const monitorStatus = store.getMonitorStatus();
    const monitorPlayers = store.listMonitorPlayers();
    if (monitorStatus.online && monitorPlayers.length > 0) {
      return monitorPlayers.map(player => ({
        id: player.id,
        name: player.name,
        ping: player.ping || 0,
        identifiers: player.identifiers || [],
        hwids: player.hwids || [],
        role: 'player',
        source: 'monitor',
      }));
    }

    if (!process.env.FIVEM_SERVER_URL) return mockPlayers;

    const players = await fetchFiveMJson('/players.json');
    return players.map((player: any) => ({
      id: player.id,
      name: player.name,
      ping: player.ping || 0,
      identifiers: player.identifiers || [],
      hwids: [],
      role: 'player',
    }));
  };

  const monitorAdminFromBody = (body: any) => {
    const identifiers = cleanIdentifierList(body?.adminIdentifiers || body?.identifiers);
    return store.findAdminByIdentifiers(identifiers);
  };

  const adminHasPermission = (admin: { permissions: string[] } | null, permission: string) => (
    Boolean(admin?.permissions.includes('all_permissions') || admin?.permissions.includes(permission))
  );

  const menuPermissionForAction = (action: string) => ({
    kick: 'players.kick',
    ban: 'players.ban',
    warn: 'players.warn',
    direct_message: 'players.direct_message',
    heal: 'players.heal',
    freeze: 'players.freeze',
    teleport: 'players.teleport',
    spectate: 'players.spectate',
    viewids: 'menu.viewids',
  } as Record<string, string>)[action] || '';

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
      logger.add('INFO', 'Database pool created successfully', 'database', 'server');
    } else {
      logger.add('WARN', 'Database credentials not provided, running in mock DB mode', 'database', 'server');
    }
  } catch (error: any) {
    logger.add('ERROR', `Database connection failed: ${error.message}`, 'database', 'server');
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
        hwids: Array.isArray(player.hwids) ? player.hwids.filter((hwid: unknown) => typeof hwid === 'string') : [],
        endpoint: typeof player.endpoint === 'string' ? player.endpoint : null,
        updatedAt: new Date().toISOString(),
      }));

    const stored = store.upsertMonitorPlayers(normalized);
    store.logMonitorEvent({ eventName: 'players.report', direction: 'inbound', status: 'success', payload: { count: stored.length } });
    realtime.broadcast('players', stored);
    res.json({ ok: true, players: stored.length });
  });

  app.post('/api/monitor/player/check-join', requireMonitorToken, (req, res) => {
    const sourceId = Number.isFinite(Number(req.body?.sourceId)) ? Number(req.body.sourceId) : null;
    const result = store.checkJoin({
      sourceId,
      name: typeof req.body?.name === 'string' ? req.body.name : 'Connecting Player',
      identifiers: cleanIdentifierList(req.body?.identifiers),
      hwids: cleanIdentifierList(req.body?.hwids),
      discordId: typeof req.body?.discordId === 'string' ? req.body.discordId : null,
    });

    store.logMonitorEvent({
      eventName: 'player.checkJoin',
      direction: 'inbound',
      status: result.allow ? 'allowed' : 'denied',
      payload: { sourceId, playerId: result.player.id, actionId: result.action?.id, decision: result.decision },
    });

    res.json(result.allow ? { allow: true } : { allow: false, reason: result.reason });
  });

  app.post('/api/monitor/warnings/:id/ack', requireMonitorToken, (req, res) => {
    const sourceId = Number.isFinite(Number(req.body?.sourceId)) ? Number(req.body.sourceId) : null;
    const action = store.acknowledgeWarning(req.params.id, sourceId, {
      playerName: typeof req.body?.playerName === 'string' ? req.body.playerName : null,
      resourceName: typeof req.body?.resourceName === 'string' ? req.body.resourceName : null,
    });
    if (!action) return res.status(404).json({ error: 'Warning not found' });

    store.logMonitorEvent({
      eventName: 'player.warningAcknowledged',
      direction: 'inbound',
      status: 'success',
      payload: { actionId: action.id, sourceId },
    });
    res.json({ ok: true, action });
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

  app.post('/api/monitor/activity', requireMonitorToken, (req, res) => {
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : 'activity';
    const source = typeof req.body?.source === 'string' ? req.body.source.trim() : 'monitor';
    const level = typeof req.body?.level === 'string' ? req.body.level.toUpperCase() : 'INFO';
    const message = typeof req.body?.message === 'string' && req.body.message.trim()
      ? req.body.message.trim()
      : `${type} ${JSON.stringify(req.body?.payload ?? {})}`;
    const log = logger.add(level, message, source, 'server');
    store.logMonitorEvent({
      eventName: `activity.${type}`,
      direction: 'inbound',
      status: 'success',
      payload: req.body?.payload ?? req.body ?? null,
    });
    realtime.broadcast('logs', [log]);
    res.json({ ok: true, log });
  });

  app.post('/api/monitor/admin/auth', requireMonitorToken, (req, res) => {
    const sourceId = Number.isFinite(Number(req.body?.sourceId)) ? Number(req.body.sourceId) : null;
    const identifiers = cleanIdentifierList(req.body?.identifiers);
    const admin = store.findAdminByIdentifiers(identifiers);

    if (!admin) {
      store.logMonitorEvent({
        eventName: 'adminAuth',
        direction: 'inbound',
        status: 'denied',
        payload: { sourceId, identifierCount: identifiers.length },
      });
      return res.status(403).json({ authorized: false, error: 'No linked Portside admin was found for this player' });
    }

    store.logMonitorEvent({
      eventName: 'adminAuth',
      direction: 'inbound',
      status: 'success',
      payload: { sourceId, adminId: admin.id, username: admin.username },
    });

    res.json({
      authorized: true,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        permissions: admin.permissions,
      },
    });
  });

  app.post('/api/monitor/menu/action', requireMonitorToken, async (req, res) => {
    const action = typeof req.body?.action === 'string' ? req.body.action.trim() : '';
    const permission = menuPermissionForAction(action);
    if (!permission) return res.status(400).json({ error: 'Unsupported menu action' });

    const admin = monitorAdminFromBody(req.body);
    if (!admin) return res.status(403).json({ error: 'In-game admin is not linked to a Portside admin' });
    if (!adminHasPermission(admin, permission)) {
      store.logAction({
        actorAdminId: admin.id,
        actorUsername: admin.username,
        action: `menu.${action}`,
        method: req.method,
        route: req.originalUrl,
        permission,
        status: 'denied',
        ip: req.ip,
        details: { sourceId: req.body?.sourceId, targetSourceId: req.body?.targetSourceId },
      });
      return res.status(403).json({ error: `Missing permission: ${permission}` });
    }

    const targetSourceId = Number.isFinite(Number(req.body?.targetSourceId)) ? Number(req.body.targetSourceId) : null;
    const target = targetSourceId !== null ? store.getPlayerBySource(targetSourceId) : null;
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Action from Portside menu';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const duration = typeof req.body?.duration === 'string' && req.body.duration.trim() ? req.body.duration.trim() : 'permanent';
    const sourceId = Number.isFinite(Number(req.body?.sourceId)) ? Number(req.body.sourceId) : null;

    try {
      if ((action === 'kick' || action === 'ban' || action === 'warn' || action === 'direct_message') && !target) {
        return res.status(404).json({ error: 'Target player is not known to Portside yet' });
      }

      if (action === 'ban' && target) {
        const activeBan = store.getActiveBanForPlayer(target.id);
        if (activeBan) return res.status(409).json({ error: 'Player already has an active ban', action: activeBan });
      }

      let moderationAction: any = null;
      if (action === 'kick' && target) {
        moderationAction = store.createModerationAction({
          type: 'kick',
          playerId: target.id,
          reason,
          authorAdminId: admin.id,
          authorUsername: admin.username,
          metadata: { sourceId: targetSourceId, fromMenu: true },
        });
        relayMonitorEvent('playerKicked', { target: targetSourceId, author: admin.username, reason, dropMessage: reason });
      } else if (action === 'ban' && target) {
        moderationAction = store.createModerationAction({
          type: 'ban',
          playerId: target.id,
          reason,
          durationInput: duration,
          authorAdminId: admin.id,
          authorUsername: admin.username,
          metadata: { sourceId: targetSourceId, fromMenu: true },
        });
        relayMonitorEvent('playerBanned', {
          author: admin.username,
          reason,
          actionId: moderationAction.id,
          expiration: moderationAction.expiresAt || false,
          durationInput: duration,
          targetNetId: targetSourceId,
          targetIds: moderationAction.targetIdentifiers,
          targetHwids: moderationAction.targetHwids,
          targetName: target.displayName,
          kickMessage: `Banned: ${reason}`,
        });
      } else if (action === 'warn' && target) {
        moderationAction = store.createModerationAction({
          type: 'warn',
          playerId: target.id,
          reason,
          authorAdminId: admin.id,
          authorUsername: admin.username,
          metadata: { sourceId: targetSourceId, fromMenu: true },
        });
        relayMonitorEvent('playerWarned', {
          author: admin.username,
          reason,
          actionId: moderationAction.id,
          targetNetId: targetSourceId,
          targetIds: moderationAction.targetIdentifiers,
          targetHwids: moderationAction.targetHwids,
          targetName: target.displayName,
        });
      } else if (action === 'direct_message' && target) {
        if (!message) return res.status(400).json({ error: 'Message is required' });
        moderationAction = store.createModerationAction({
          type: 'dm',
          playerId: target.id,
          reason: message,
          authorAdminId: admin.id,
          authorUsername: admin.username,
          metadata: { sourceId: targetSourceId, fromMenu: true },
        });
        relayMonitorEvent('playerDirectMessage', {
          target: targetSourceId,
          author: admin.username,
          message,
          actionId: moderationAction.id,
          targetIds: moderationAction.targetIdentifiers,
          targetName: target.displayName,
        });
      }

      store.logAction({
        actorAdminId: admin.id,
        actorUsername: admin.username,
        action: `menu.${action}`,
        method: req.method,
        route: req.originalUrl,
        permission,
        status: 'success',
        ip: req.ip,
        details: { sourceId, targetSourceId, reason, message: message ? '[redacted length ' + message.length + ']' : undefined, duration, moderationActionId: moderationAction?.id },
      });

      res.json({ ok: true, action, permission, moderationAction });
    } catch (err: any) {
      store.logAction({
        actorAdminId: admin.id,
        actorUsername: admin.username,
        action: `menu.${action}`,
        method: req.method,
        route: req.originalUrl,
        permission,
        status: 'failed',
        ip: req.ip,
        details: { error: err.message, sourceId, targetSourceId },
      });
      res.status(500).json({ error: err.message || 'Menu action failed' });
    }
  });

  app.get('/api/setup/status', (_req, res) => {
    res.json({ setupRequired: !store.hasOwner() });
  });

  app.post('/api/setup/admin', (req, res) => {
    createOwner(store, req, res).catch(error => {
      logger.add('ERROR', `Setup error: ${error.message}`, 'auth', 'admin');
      res.status(500).json({ error: 'Failed to complete setup' });
    });
  });

  app.post('/api/auth/login', (req, res) => {
    login(store, req, res).catch(error => {
      logger.add('ERROR', `Login error: ${error.message}`, 'auth', 'admin');
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
      const metrics = sampleRuntimeMetrics();
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
          logger.add('WARN', `Could not connect to external FiveM server at ${process.env.FIVEM_SERVER_URL}`, 'system', 'server');
        }
      } else {
        online = true;
        players = 42;
      }

      res.json({
        online,
        players,
        maxPlayers,
        cpuUsage: metrics.process.cpuUsage,
        memoryUsage: metrics.process.memoryUsage,
        uptime: metrics.process.uptime,
        metrics,
        monitor: monitorStatus,
        fxserver: fxServer.getStatus(),
      });
    } catch (err: any) {
      logger.add('ERROR', `Could not fetch server status: ${err.message}`, 'system', 'server');
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

  app.get('/api/server/control/status', authenticateToken, requirePermission(store, 'control.server'), (_req, res) => {
    res.json(fxServer.getStatus());
  });

  app.post('/api/server/control/start', authenticateToken, requirePermission(store, 'control.server'), async (req: AuthedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Started from Portside';
    try {
      const status = await fxServer.start(reason);
      store.logAction({ ...actionActor(req), action: 'server.start', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'success', details: { reason, status } });
      realtime.broadcast('status', { fxserver: status });
      res.json(status);
    } catch (error: any) {
      store.logAction({ ...actionActor(req), action: 'server.start', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'failed', details: { reason, error: error.message } });
      res.status(fxServer.isManagedMode() ? 400 : 409).json({ error: error.message });
    }
  });

  app.post('/api/server/control/stop', authenticateToken, requirePermission(store, 'control.server'), async (req: AuthedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'Stop reason is required' });
    try {
      await relayMonitorEvent('serverShuttingDown', {
        delay: 0,
        author: req.user?.username || 'Portside',
        message: reason,
      });
      const status = await fxServer.stop(reason);
      store.logAction({ ...actionActor(req), action: 'server.stop', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'success', details: { reason, status } });
      realtime.broadcast('status', { fxserver: status });
      res.json(status);
    } catch (error: any) {
      store.logAction({ ...actionActor(req), action: 'server.stop', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'failed', details: { reason, error: error.message } });
      res.status(fxServer.isManagedMode() ? 400 : 409).json({ error: error.message });
    }
  });

  app.post('/api/server/control/restart', authenticateToken, requirePermission(store, 'control.server'), async (req: AuthedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'Restart reason is required' });
    const delayMs = Math.max(0, Math.min(Number(req.body?.delayMs || 0), 10 * 60 * 1000));
    try {
      await relayMonitorEvent('serverShuttingDown', {
        delay: delayMs,
        author: req.user?.username || 'Portside',
        message: typeof req.body?.message === 'string' && req.body.message.trim() ? req.body.message.trim() : reason,
      });
      const status = await fxServer.restart(reason, delayMs);
      store.logAction({ ...actionActor(req), action: 'server.restart', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'success', details: { reason, delayMs, status } });
      realtime.broadcast('status', { fxserver: status });
      res.json(status);
    } catch (error: any) {
      store.logAction({ ...actionActor(req), action: 'server.restart', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'failed', details: { reason, delayMs, error: error.message } });
      res.status(fxServer.isManagedMode() ? 400 : 409).json({ error: error.message });
    }
  });

  app.get('/host/status', (req: AuthedRequest, res) => {
    if (!hasHostToken(req)) return res.status(401).json({ error: 'Invalid host status token' });
    const status = store.getMonitorStatus() as any;
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      portside: sampleRuntimeMetrics(),
      monitor: {
        installed: status.installed,
        online: status.online,
        lastHeartbeatAt: status.lastHeartbeatAt,
        resourceName: status.resourceName,
        version: status.version,
      },
    });
  });

  app.get('/api/diagnostics', authenticateToken, requirePermission(store, 'settings.view'), async (_req, res) => {
    res.json(await collectDiagnostics({ store, logger, fxServer, discordStatus, dbPool }));
  });

  app.get('/api/diagnostics/bundle', authenticateToken, requirePermission(store, 'settings.view'), async (_req, res) => {
    const bundle = await collectDiagnosticsBundle({ store, logger, fxServer, discordStatus, dbPool });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="portside-diagnostics-${timestamp}.json"`);
    res.send(JSON.stringify(bundle, null, 2));
  });

  const normalizeWarnings = (value: unknown) => (
    Array.isArray(value) ? value.map(Number).filter(item => Number.isFinite(item) && item > 0) : [30, 15, 10, 5, 4, 3, 2, 1]
  );

  const decorateSchedules = () => store.listRestartSchedules().map(schedule => ({
    ...schedule,
    nextOccurrenceAt: schedule.enabled ? nextOccurrenceForSchedule(schedule)?.toISOString() || null : null,
  }));

  app.get('/api/server/restarts', authenticateToken, requirePermission(store, 'control.server'), (_req, res) => {
    res.json(decorateSchedules());
  });

  app.get('/api/whitelist/status', authenticateToken, requirePermission(store, 'players.whitelist'), (_req, res) => {
    res.json({
      mode: store.getWhitelistMode(),
      entries: store.listWhitelistEntries().length,
      pendingRequests: store.listWhitelistRequests('pending').length,
      discord: {
        ...store.getDiscordStatusSettings(),
        bot: discordStatus?.getStatus() || { configured: false, enabled: false, connected: false, lastUpdateAt: null, lastError: null },
        tokenConfigured: Boolean(process.env.PORTSIDE_DISCORD_BOT_TOKEN),
      },
    });
  });

  app.get('/api/whitelist/entries', authenticateToken, requirePermission(store, 'players.whitelist'), (_req, res) => {
    res.json(store.listWhitelistEntries());
  });

  app.post('/api/whitelist/entries', authenticateToken, requirePermission(store, 'players.whitelist'), (req: AuthedRequest, res) => {
    try {
      const type = req.body?.type === 'discord' || req.body?.type === 'player' ? req.body.type : 'identifier';
      const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      if (!value) return res.status(400).json({ error: 'Whitelist value is required' });
      const entry = store.createWhitelistEntry({
        type,
        value,
        playerId: typeof req.body?.playerId === 'string' ? req.body.playerId : null,
        discordId: typeof req.body?.discordId === 'string' ? req.body.discordId : null,
        note: note || null,
        actorAdminId: req.user?.id || null,
        actorUsername: req.user?.username || null,
      });
      store.logAction({ ...actionActor(req), action: 'whitelist.entry.create', method: req.method, route: req.originalUrl, permission: 'players.whitelist', status: 'success', details: { entryId: entry.id, type: entry.type } });
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to create whitelist entry' });
    }
  });

  app.delete('/api/whitelist/entries/:id', authenticateToken, requirePermission(store, 'players.whitelist'), (req: AuthedRequest, res) => {
    const deleted = store.deleteWhitelistEntry(req.params.id);
    store.logAction({ ...actionActor(req), action: 'whitelist.entry.delete', method: req.method, route: req.originalUrl, permission: 'players.whitelist', status: deleted ? 'success' : 'failed', details: { entryId: req.params.id } });
    if (!deleted) return res.status(404).json({ error: 'Whitelist entry not found' });
    res.json({ success: true });
  });

  app.get('/api/whitelist/requests', authenticateToken, requirePermission(store, 'players.whitelist'), (req, res) => {
    res.json(store.listWhitelistRequests(typeof req.query.status === 'string' ? req.query.status : undefined));
  });

  app.post('/api/whitelist/requests', authenticateToken, requirePermission(store, 'players.whitelist'), async (req: AuthedRequest, res) => {
    const playerName = typeof req.body?.playerName === 'string' && req.body.playerName.trim() ? req.body.playerName.trim() : 'Unknown Player';
    const request = store.createWhitelistRequest({
      playerName,
      identifiers: cleanIdentifierList(req.body?.identifiers),
      hwids: cleanIdentifierList(req.body?.hwids),
      discordId: typeof req.body?.discordId === 'string' ? req.body.discordId.trim() : null,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.trim() : null,
    });
    await relayMonitorEvent('whitelistRequest', { requestId: request.id, playerName, identifiers: request.identifiers, discordId: request.discordId });
    store.logAction({ ...actionActor(req), action: 'whitelist.request.create', method: req.method, route: req.originalUrl, permission: 'players.whitelist', status: 'success', details: { requestId: request.id } });
    res.status(201).json(request);
  });

  const reviewWhitelistRequest = (status: 'approved' | 'rejected') => async (req: AuthedRequest, res: Response) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const request = store.reviewWhitelistRequest({
      id: req.params.id,
      status,
      reason: reason || null,
      actorAdminId: req.user?.id || null,
      actorUsername: req.user?.username || null,
    });
    if (!request) return res.status(404).json({ error: 'Whitelist request not found' });
    if (status === 'approved') {
      await relayMonitorEvent('whitelistPreApproval', { requestId: request.id, playerName: request.playerName, identifiers: request.identifiers, discordId: request.discordId });
    }
    store.logAction({ ...actionActor(req), action: `whitelist.request.${status}`, method: req.method, route: req.originalUrl, permission: 'players.whitelist', status: 'success', details: { requestId: request.id } });
    res.json(request);
  };

  app.post('/api/whitelist/requests/:id/approve', authenticateToken, requirePermission(store, 'players.whitelist'), reviewWhitelistRequest('approved'));
  app.post('/api/whitelist/requests/:id/reject', authenticateToken, requirePermission(store, 'players.whitelist'), reviewWhitelistRequest('rejected'));

  app.put('/api/discord/status-settings', authenticateToken, requirePermission(store, 'players.whitelist'), async (req: AuthedRequest, res) => {
    const settings = store.updateDiscordStatusSettings({
      enabled: Boolean(req.body?.enabled),
      guildId: typeof req.body?.guildId === 'string' ? req.body.guildId.trim() : null,
      statusChannelId: typeof req.body?.statusChannelId === 'string' ? req.body.statusChannelId.trim() : null,
      statusMessageId: typeof req.body?.statusMessageId === 'string' ? req.body.statusMessageId.trim() : null,
      updateIntervalSeconds: Number(req.body?.updateIntervalSeconds || 60),
    });
    store.logAction({ ...actionActor(req), action: 'discord.status_settings.update', method: req.method, route: req.originalUrl, permission: 'players.whitelist', status: 'success', details: { enabled: settings.enabled } });
    if (settings.enabled) {
      await discordStatus?.start();
      await discordStatus?.updateStatusEmbed();
    } else {
      discordStatus?.stop();
    }
    res.json({ ...settings, tokenConfigured: Boolean(process.env.PORTSIDE_DISCORD_BOT_TOKEN), bot: discordStatus?.getStatus() });
  });

  app.post('/api/server/restarts', authenticateToken, requirePermission(store, 'control.server'), (req: AuthedRequest, res) => {
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'Daily restart';
    const timeOfDay = typeof req.body?.timeOfDay === 'string' ? req.body.timeOfDay.trim() : '';
    if (!/^\d{2}:\d{2}$/.test(timeOfDay)) return res.status(400).json({ error: 'timeOfDay must use HH:mm format' });
    const schedule = store.createRestartSchedule({
      name,
      type: 'daily',
      timeOfDay,
      warningMinutes: normalizeWarnings(req.body?.warningMinutes),
      message: typeof req.body?.message === 'string' ? req.body.message.trim() : null,
      enabled: req.body?.enabled !== false,
    });
    store.logAction({ ...actionActor(req), action: 'server.restart_schedule.create', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'success', details: { scheduleId: schedule.id } });
    res.status(201).json({ ...schedule, nextOccurrenceAt: nextOccurrenceForSchedule(schedule)?.toISOString() || null });
  });

  app.put('/api/server/restarts/:id', authenticateToken, requirePermission(store, 'control.server'), (req: AuthedRequest, res) => {
    const existing = store.getRestartSchedule(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Restart schedule not found' });
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : existing.name;
    const timeOfDay = existing.type === 'daily'
      ? (typeof req.body?.timeOfDay === 'string' ? req.body.timeOfDay.trim() : existing.timeOfDay)
      : null;
    if (existing.type === 'daily' && (!timeOfDay || !/^\d{2}:\d{2}$/.test(timeOfDay))) return res.status(400).json({ error: 'timeOfDay must use HH:mm format' });
    const schedule = store.updateRestartSchedule(req.params.id, {
      name,
      enabled: req.body?.enabled !== undefined ? Boolean(req.body.enabled) : existing.enabled,
      timeOfDay,
      executeAt: existing.type === 'temporary' && typeof req.body?.executeAt === 'string' ? new Date(req.body.executeAt).toISOString() : existing.executeAt,
      warningMinutes: normalizeWarnings(req.body?.warningMinutes || existing.warningMinutes),
      message: typeof req.body?.message === 'string' ? req.body.message.trim() : existing.message,
    });
    store.logAction({ ...actionActor(req), action: 'server.restart_schedule.update', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'success', details: { scheduleId: req.params.id } });
    res.json(schedule ? { ...schedule, nextOccurrenceAt: nextOccurrenceForSchedule(schedule)?.toISOString() || null } : null);
  });

  app.delete('/api/server/restarts/:id', authenticateToken, requirePermission(store, 'control.server'), (req: AuthedRequest, res) => {
    const deleted = store.deleteRestartSchedule(req.params.id);
    store.logAction({ ...actionActor(req), action: 'server.restart_schedule.delete', method: req.method, route: req.originalUrl, permission: 'control.server', status: deleted ? 'success' : 'failed', details: { scheduleId: req.params.id } });
    res.json({ success: deleted });
  });

  app.post('/api/server/restarts/:id/skip-next', authenticateToken, requirePermission(store, 'control.server'), async (req: AuthedRequest, res) => {
    const schedule = store.getRestartSchedule(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Restart schedule not found' });
    const occurrence = nextOccurrenceForSchedule(schedule);
    if (!occurrence) return res.status(400).json({ error: 'No upcoming restart occurrence to skip' });
    store.skipRestartOccurrence({
      scheduleId: schedule.id,
      occurrenceAt: occurrence.toISOString(),
      authorAdminId: req.user?.id,
      authorUsername: req.user?.username,
    });
    const secondsRemaining = Math.max(0, Math.floor((occurrence.getTime() - Date.now()) / 1000));
    await relayMonitorEvent('scheduledRestartSkipped', {
      secondsRemaining,
      temporary: true,
      author: req.user?.username || 'Portside',
    });
    store.logAction({ ...actionActor(req), action: 'server.restart_schedule.skip_next', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'success', details: { scheduleId: schedule.id, occurrenceAt: occurrence.toISOString() } });
    res.json({ success: true, occurrenceAt: occurrence.toISOString() });
  });

  app.post('/api/server/restarts/temporary', authenticateToken, requirePermission(store, 'control.server'), (req: AuthedRequest, res) => {
    const executeAt = typeof req.body?.executeAt === 'string' ? new Date(req.body.executeAt) : null;
    if (!executeAt || Number.isNaN(executeAt.getTime()) || executeAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'executeAt must be a future ISO timestamp' });
    }
    const schedule = store.createRestartSchedule({
      name: typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'Temporary restart',
      type: 'temporary',
      executeAt: executeAt.toISOString(),
      warningMinutes: normalizeWarnings(req.body?.warningMinutes),
      message: typeof req.body?.message === 'string' ? req.body.message.trim() : null,
    });
    store.logAction({ ...actionActor(req), action: 'server.restart_temporary.create', method: req.method, route: req.originalUrl, permission: 'control.server', status: 'success', details: { scheduleId: schedule.id, executeAt: schedule.executeAt } });
    res.status(201).json({ ...schedule, nextOccurrenceAt: nextOccurrenceForSchedule(schedule)?.toISOString() || null });
  });

  app.get('/api/players', authenticateToken, async (_req, res) => {
    try {
      res.json(await listOnlinePlayers());
    } catch (err: any) {
      logger.add('ERROR', `Could not fetch FiveM players: ${err.message}`, 'system', 'server');
      res.status(502).json({ error: 'Failed to fetch FiveM players' });
    }
  });

  app.post('/api/players/kick-all', authenticateToken, requirePermission(store, 'players.kick'), async (req: AuthedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'Kick-all reason is required' });

    try {
      const players = (await listOnlinePlayers()).filter((player: any) => Number.isFinite(Number(player.id)));
      const results = [];
      for (const onlinePlayer of players) {
        const sourceId = Number(onlinePlayer.id);
        try {
          await runRconCommand(`clientkick ${sourceId} ${reason}`);
          const player = store.getPlayerBySource(sourceId) || store.upsertPlayerSnapshot({
            sourceId,
            name: onlinePlayer.name || `Player ${sourceId}`,
            identifiers: onlinePlayer.identifiers || [],
            hwids: onlinePlayer.hwids || [],
          });
          const action = store.createModerationAction({
            type: 'kick',
            playerId: player.id,
            reason,
            authorAdminId: req.user?.id,
            authorUsername: req.user?.username,
            metadata: { sourceId, batch: 'kick-all' },
          });
          results.push({ sourceId, ok: true, actionId: action.id });
        } catch (error: any) {
          logger.add('WARN', `Kick-all failed for ${sourceId}: ${error.message}`, 'moderation', 'server');
          results.push({ sourceId, ok: false, error: error.message });
        }
      }

      relayMonitorEvent('playerKicked', {
        target: -1,
        author: req.user?.username || 'Portside',
        reason,
        dropMessage: reason,
      });
      store.logAction({ ...actionActor(req), action: 'players.kick_all', method: req.method, route: req.originalUrl, permission: 'players.kick', status: results.some(result => result.ok) ? 'success' : 'failed', details: { reason, results } });
      res.json({ success: results.some(result => result.ok), results });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Failed to kick all players' });
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
      const player = store.getPlayerBySource(Number(id));
      if (player) {
        store.createModerationAction({
          type: 'kick',
          playerId: player.id,
          reason,
          authorAdminId: req.user?.id,
          authorUsername: req.user?.username,
          metadata: { sourceId: Number(id) },
        });
      }
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

      const player = store.getPlayerBySource(Number(id)) || store.upsertPlayerSnapshot({
        sourceId: Number(id),
        name: `Player ${id}`,
        identifiers: [],
        hwids: [],
      });
      const activeBan = store.getActiveBanForPlayer(player.id);
      if (activeBan) {
        return res.status(409).json({ error: 'Player already has an active ban', action: activeBan });
      }

      const action = store.createModerationAction({
        type: 'ban',
        playerId: player.id,
        reason: String(reason).trim(),
        durationInput: String(duration).trim(),
        authorAdminId: req.user?.id,
        authorUsername: req.user?.username,
        metadata: { sourceId: Number(id) },
      });

      if (process.env.FIVEM_RCON_BAN_COMMAND) {
        const command = process.env.FIVEM_RCON_BAN_COMMAND
          .replaceAll('{id}', id)
          .replaceAll('{reason}', String(reason).trim())
          .replaceAll('{duration}', String(duration).trim());
        await runRconCommand(command);
      } else {
        await runRconCommand(`clientkick ${id} Banned: ${String(reason).trim()}`);
      }

      relayMonitorEvent('playerBanned', {
        author: req.user?.username || 'Portside',
        reason: String(reason).trim(),
        actionId: action.id,
        expiration: action.expiresAt || false,
        durationInput: String(duration).trim(),
        targetNetId: Number(id),
        targetIds: action.targetIdentifiers,
        targetHwids: action.targetHwids,
        targetName: action.targetName,
        kickMessage: `Banned: ${String(reason).trim()}`,
      });
      store.logAction({ ...actionActor(req), action: 'players.ban', method: req.method, route: req.originalUrl, permission: 'players.ban', status: 'success', details: { id, reason, duration, actionId: action.id } });
      res.json({ success: true, action });
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Failed to ban player' });
    }
  });

  app.get('/api/logs', authenticateToken, requirePermission(store, 'txadmin.log.view'), (req: AuthedRequest, res) => {
    const family = logFamily(req.query.type);
    if (family === 'server' && !hasPermissionName(req, 'server.log.view')) {
      return res.status(403).json({ error: 'Missing permission server.log.view' });
    }
    const entries = logger.search({
      family,
      limit: Number(req.query.limit || 100),
      query: typeof req.query.query === 'string' ? req.query.query : undefined,
      level: typeof req.query.level === 'string' ? req.query.level : undefined,
      source: typeof req.query.source === 'string' ? req.query.source : undefined,
    });
    if (family === 'admin') {
      const actionEntries = store.recentActionLogs(Number(req.query.limit || 100)).map((log: any) => ({
        id: log.id,
        timestamp: log.timestamp,
        level: log.status === 'denied' || log.status === 'failed' ? 'WARN' : 'INFO',
        source: 'admin',
        message: `${log.actorUsername || 'system'} ${log.action}${log.permission ? ` (${log.permission})` : ''}`,
        family: 'admin',
      }));
      return res.json([...entries, ...actionEntries]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, Number(req.query.limit || 100)));
    }
    res.json(!family && !hasPermissionName(req, 'server.log.view') ? entries.filter(entry => entry.family !== 'server') : entries);
  });

  app.get('/api/admin-logs', authenticateToken, requirePermission(store, 'txadmin.log.view'), (_req, res) => {
    res.json(store.recentActionLogs());
  });

  app.get('/api/logs/files', authenticateToken, requirePermission(store, 'txadmin.log.view'), (req: AuthedRequest, res) => {
    const family = logFamily(req.query.type);
    if (!family) return res.status(400).json({ error: 'Log type is required' });
    if (family === 'server' && !hasPermissionName(req, 'server.log.view')) {
      return res.status(403).json({ error: 'Missing permission server.log.view' });
    }
    res.json(logger.listFiles(family));
  });

  app.get('/api/logs/files/:type/:file/download', authenticateToken, requirePermission(store, 'txadmin.log.view'), (req: AuthedRequest, res) => {
    const family = logFamily(req.params.type);
    if (!family) return res.status(400).json({ error: 'Invalid log type' });
    if (family === 'server' && !hasPermissionName(req, 'server.log.view')) {
      return res.status(403).json({ error: 'Missing permission server.log.view' });
    }
    const file = path.basename(req.params.file);
    const target = logger.resolveFile(family, file);
    if (!target) return res.status(404).json({ error: 'Log file not found' });
    res.download(target, file);
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

  app.get('/api/moderation/players', authenticateToken, (req, res) => {
    res.json(store.searchPlayers(typeof req.query.query === 'string' ? req.query.query : ''));
  });

  app.get('/api/moderation/players/:id', authenticateToken, (req, res) => {
    const profile = store.getPlayerProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Player not found' });
    res.json(profile);
  });

  app.post('/api/moderation/players/:id/bans', authenticateToken, requirePermission(store, 'players.ban'), async (req: AuthedRequest, res) => {
    const player = store.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const activeBan = store.getActiveBanForPlayer(player.id);
    if (activeBan) {
      return res.status(409).json({ error: 'Player already has an active ban', action: activeBan });
    }

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Banned by Portside';
    const duration = typeof req.body?.duration === 'string' ? req.body.duration.trim() : 'permanent';
    const action = store.createModerationAction({
      type: 'ban',
      playerId: player.id,
      reason,
      durationInput: duration,
      authorAdminId: req.user?.id,
      authorUsername: req.user?.username,
    });

    if (player.lastSource !== null) {
      try {
        if (process.env.FIVEM_RCON_BAN_COMMAND) {
          const command = process.env.FIVEM_RCON_BAN_COMMAND
            .replaceAll('{id}', String(player.lastSource))
            .replaceAll('{reason}', reason)
            .replaceAll('{duration}', duration);
          await runRconCommand(command);
        } else {
          await runRconCommand(`clientkick ${player.lastSource} Banned: ${reason}`);
        }
      } catch (error: any) {
        logger.add('WARN', `Online ban side effect failed: ${error.message}`, 'moderation', 'server');
      }
    }

    relayMonitorEvent('playerBanned', {
      author: req.user?.username || 'Portside',
      reason,
      actionId: action.id,
      expiration: action.expiresAt || false,
      durationInput: duration,
      targetNetId: player.lastSource,
      targetIds: action.targetIdentifiers,
      targetHwids: action.targetHwids,
      targetName: player.displayName,
      kickMessage: `Banned: ${reason}`,
    });
    store.logAction({ ...actionActor(req), action: 'moderation.ban', method: req.method, route: req.originalUrl, permission: 'players.ban', status: 'success', details: { playerId: player.id, actionId: action.id, duration } });
    res.status(201).json(action);
  });

  app.post('/api/moderation/players/:id/warnings', authenticateToken, requirePermission(store, 'players.warn'), (req: AuthedRequest, res) => {
    const player = store.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const profile = store.getPlayerProfile(player.id);
    if (!profile?.sourceId) return res.status(409).json({ error: 'Player must be online to receive a warning' });

    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Warned by Portside';
    const action = store.createModerationAction({
      type: 'warn',
      playerId: player.id,
      reason,
      authorAdminId: req.user?.id,
      authorUsername: req.user?.username,
    });
    relayMonitorEvent('playerWarned', {
      author: req.user?.username || 'Portside',
      reason,
      actionId: action.id,
      targetNetId: profile.sourceId,
      targetIds: action.targetIdentifiers,
      targetHwids: action.targetHwids,
      targetName: player.displayName,
    });
    store.logAction({ ...actionActor(req), action: 'moderation.warn', method: req.method, route: req.originalUrl, permission: 'players.warn', status: 'success', details: { playerId: player.id, actionId: action.id } });
    res.status(201).json(action);
  });

  app.post('/api/moderation/players/:id/direct-message', authenticateToken, requirePermission(store, 'players.direct_message'), async (req: AuthedRequest, res) => {
    const player = store.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const profile = store.getPlayerProfile(player.id);
    if (!profile?.sourceId) return res.status(409).json({ error: 'Player must be online to receive a direct message' });

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const action = store.createModerationAction({
      type: 'dm',
      playerId: player.id,
      reason: message,
      authorAdminId: req.user?.id,
      authorUsername: req.user?.username,
      metadata: { sourceId: profile.sourceId },
    });

    const relayed = await relayMonitorEvent('playerDirectMessage', {
      target: profile.sourceId,
      author: req.user?.username || 'Portside',
      message,
      actionId: action.id,
      targetIds: action.targetIdentifiers,
      targetName: player.displayName,
    });

    store.logAction({ ...actionActor(req), action: 'moderation.direct_message', method: req.method, route: req.originalUrl, permission: 'players.direct_message', status: 'success', details: { playerId: player.id, actionId: action.id, delivered: relayed } });
    res.status(201).json({ ...action, delivered: relayed });
  });

  app.post('/api/moderation/players/:id/notes', authenticateToken, requirePermission(store, 'players.warn'), (req: AuthedRequest, res) => {
    const player = store.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) return res.status(400).json({ error: 'Note is required' });
    const created = store.createPlayerNote(player.id, note, req.user?.id || null, req.user?.username || null);
    store.logAction({ ...actionActor(req), action: 'moderation.note.create', method: req.method, route: req.originalUrl, permission: 'players.warn', status: 'success', details: { playerId: player.id, noteId: (created as any)?.id } });
    res.status(201).json(created);
  });

  app.put('/api/moderation/notes/:id', authenticateToken, requirePermission(store, 'players.warn'), (req: AuthedRequest, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) return res.status(400).json({ error: 'Note is required' });
    const updated = store.updatePlayerNote(req.params.id, note);
    if (!updated) return res.status(404).json({ error: 'Note not found' });
    store.logAction({ ...actionActor(req), action: 'moderation.note.update', method: req.method, route: req.originalUrl, permission: 'players.warn', status: 'success', details: { noteId: req.params.id } });
    res.json(updated);
  });

  app.delete('/api/moderation/notes/:id', authenticateToken, requirePermission(store, 'players.warn'), (req: AuthedRequest, res) => {
    const playerId = store.deletePlayerNote(req.params.id);
    if (!playerId) return res.status(404).json({ error: 'Note not found' });
    store.logAction({ ...actionActor(req), action: 'moderation.note.delete', method: req.method, route: req.originalUrl, permission: 'players.warn', status: 'success', details: { playerId, noteId: req.params.id } });
    res.json({ success: true });
  });

  app.post('/api/moderation/actions/:id/revoke', authenticateToken, requirePermission(store, 'players.ban'), (req: AuthedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const action = store.revokeModerationAction(req.params.id, req.user?.id || null, req.user?.username || null, reason || null);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    store.logAction({ ...actionActor(req), action: 'moderation.action.revoke', method: req.method, route: req.originalUrl, permission: 'players.ban', status: 'success', details: { actionId: req.params.id } });
    res.json(action);
  });

  app.get('/api/moderation/ban-templates', authenticateToken, requirePermission(store, 'players.ban'), (_req, res) => {
    res.json(store.listBanTemplates());
  });

  app.post('/api/moderation/ban-templates', authenticateToken, requirePermission(store, 'players.ban'), (req: AuthedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const duration = typeof req.body?.duration === 'string' ? req.body.duration.trim() : 'permanent';
    if (!name || !reason) return res.status(400).json({ error: 'Name and reason are required' });
    const template = store.createBanTemplate(name, reason, duration);
    store.logAction({ ...actionActor(req), action: 'moderation.ban_template.create', method: req.method, route: req.originalUrl, permission: 'players.ban', status: 'success', details: { templateId: (template as any)?.id } });
    res.status(201).json(template);
  });

  app.put('/api/moderation/ban-templates/:id', authenticateToken, requirePermission(store, 'players.ban'), (req: AuthedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const duration = typeof req.body?.duration === 'string' ? req.body.duration.trim() : 'permanent';
    if (!name || !reason) return res.status(400).json({ error: 'Name and reason are required' });
    const template = store.updateBanTemplate(req.params.id, name, reason, duration);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    store.logAction({ ...actionActor(req), action: 'moderation.ban_template.update', method: req.method, route: req.originalUrl, permission: 'players.ban', status: 'success', details: { templateId: req.params.id } });
    res.json(template);
  });

  app.delete('/api/moderation/ban-templates/:id', authenticateToken, requirePermission(store, 'players.ban'), (req: AuthedRequest, res) => {
    if (!store.deleteBanTemplate(req.params.id)) return res.status(404).json({ error: 'Template not found' });
    store.logAction({ ...actionActor(req), action: 'moderation.ban_template.delete', method: req.method, route: req.originalUrl, permission: 'players.ban', status: 'success', details: { templateId: req.params.id } });
    res.json({ success: true });
  });

  app.post('/api/console/command', authenticateToken, requirePermission(store, 'console.write'), async (req: AuthedRequest, res) => {
    const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
    try {
      if (!command) return res.status(400).json({ error: 'Command required' });

      logger.add('COMMAND', `> ${command}`, req.user?.username || 'admin', 'fxserver');
      const output = await runRconCommand(command);
      logger.add('INFO', output || `RCON command completed: ${command}`, 'rcon', 'fxserver');
      store.recordConsoleCommand({ adminId: req.user?.id, username: req.user?.username, command, status: 'success', output });
      store.logAction({ ...actionActor(req), action: 'console.command', method: req.method, route: req.originalUrl, permission: 'console.write', status: 'success', details: { command } });
      relayMonitorEvent('consoleCommand', {
        author: req.user?.username || 'Portside',
        command,
      });
      realtime.broadcast('logs', logger.recent(20));
      res.json({ success: true, output });
    } catch (err: any) {
      logger.add('ERROR', `RCON command failed: ${err.message}`, 'rcon', 'fxserver');
      if (command) store.recordConsoleCommand({ adminId: req.user?.id, username: req.user?.username, command, status: 'failed', output: err.message });
      res.status(502).json({ error: err.message || 'RCON command failed' });
    }
  });

  app.get('/api/console/history', authenticateToken, requirePermission(store, 'console.view'), (req: AuthedRequest, res) => {
    res.json(store.recentConsoleCommands(req.user?.id, Number(req.query.limit || 50)));
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
      logger.add('ERROR', `DB Query failed: ${err.message}`, 'database', 'server');
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/db/query', authenticateToken, requirePermission(store, 'database.write'), async (req: AuthedRequest, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    if (!dbPool) {
      if (process.env.DEBUG === 'true' || process.env.VITE_DEBUG === 'true') {
        logger.add('INFO', `Mock Executed Query: ${query}`, 'database', 'server');
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
      logger.add('INFO', `Executed Query: ${query}`, 'database', 'server');
      const [rows, fields] = await dbPool.query(query);
      store.logAction({ ...actionActor(req), action: 'database.query', method: req.method, route: req.originalUrl, permission: 'database.write', status: 'success' });
      if (Array.isArray(rows)) {
        res.json({ success: true, columns: fields ? fields.map((field: any) => field.name) : [], rows });
      } else {
        res.json({ success: true, affectedRows: (rows as any).affectedRows, message: 'Query executed successfully' });
      }
    } catch (err: any) {
      logger.add('ERROR', `DB Query failed: ${err.message}`, 'database', 'server');
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
      logger.add('ERROR', `Could not fetch FiveM resources: ${err.message}`, 'system', 'server');
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
      logger.add('ERROR', `Could not read server.cfg: ${err.message}`, 'system', 'server');
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
      logger.add('INFO', 'Configuration updated: server.cfg', 'system', 'server');
      store.logAction({ ...actionActor(req), action: 'config.update', method: req.method, route: req.originalUrl, permission: 'server.cfg.editor', status: 'success', details: { file } });
      relayMonitorEvent('configChanged', {
        author: req.user?.username || 'Portside',
        file,
      });
      realtime.broadcast('logs', logger.recent(20));
      res.json({ success: true, path: configPath });
    } catch (err: any) {
      const status = err.code === 'ENOENT' ? 404 : err.message.includes('not configured') ? 503 : 500;
      logger.add('ERROR', `Could not write server.cfg: ${err.message}`, 'system', 'server');
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

  app.put('/api/platform-users/:id/identifiers', authenticateToken, requirePermission(store, 'manage.admins'), (req: AuthedRequest, res) => {
    const identifiers = cleanIdentifierList(req.body?.identifiers);
    const user = store.setAdminIdentifiers(req.params.id, identifiers);
    if (!user) return res.status(404).json({ error: 'User not found' });
    store.logAction({
      ...actionActor(req),
      action: 'admins.set_identifiers',
      method: req.method,
      route: req.originalUrl,
      permission: 'manage.admins',
      status: 'success',
      details: { adminId: req.params.id, identifierCount: identifiers.length },
    });
    res.json(user);
  });
};
