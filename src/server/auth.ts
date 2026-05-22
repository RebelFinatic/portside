import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { PortsideStore } from './store';
import type { AuthedRequest, AuthUser } from './types';
import { hasPermission } from './permissions';

const jwtSecret = () => process.env.JWT_SECRET || 'fallback-secret-for-dev-change-me';

export const isDebugMode = () => process.env.DEBUG === 'true' || process.env.VITE_DEBUG === 'true';

export const sanitizeUser = (user: AuthUser) => ({
  id: user.id,
  username: user.username,
  roleId: user.roleId,
  role: user.role,
  permissions: user.permissions,
  isOwner: user.isOwner,
});

export const requestIp = (req: Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
};

export const signSessionToken = (sessionId: string) => {
  return jwt.sign({ sessionId }, jwtSecret(), { expiresIn: '24h' });
};

export const createSessionForAdmin = (store: PortsideStore, adminId: string) => {
  const admin = store.getAdminById(adminId);
  if (!admin || !admin.enabled) {
    throw new Error('Admin account is disabled or missing');
  }
  const session = store.createSession(admin.id);
  const token = signSessionToken(session.id);
  const user = {
    id: admin.id,
    username: admin.username,
    roleId: admin.roleId,
    role: admin.role,
    permissions: admin.permissions,
    sessionId: session.id,
    isOwner: admin.isOwner,
  };
  return { token, user };
};

export const createAuthMiddleware = (store: PortsideStore) => {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (isDebugMode()) {
      req.user = {
        id: 'debug-admin',
        username: 'debug-admin',
        roleId: 'debug-owner',
        role: 'Owner',
        permissions: ['all_permissions'],
        sessionId: 'debug-session',
        isOwner: true,
      };
      return next();
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const payload = jwt.verify(token, jwtSecret()) as { sessionId?: string };
      if (!payload.sessionId) return res.status(403).json({ error: 'Forbidden' });

      const session = store.getSession(payload.sessionId);
      if (!session) return res.status(403).json({ error: 'Session expired' });

      const admin = store.getAdminById(session.adminId);
      if (!admin || !admin.enabled) return res.status(403).json({ error: 'Forbidden' });

      req.user = {
        id: admin.id,
        username: admin.username,
        roleId: admin.roleId,
        role: admin.role,
        permissions: admin.permissions,
        sessionId: session.id,
        isOwner: admin.isOwner,
      };

      next();
    } catch {
      res.status(403).json({ error: 'Forbidden' });
    }
  };
};

export const requirePermission = (store: PortsideStore, permission: string) => {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.user && hasPermission(req.user.permissions, permission)) return next();

    store.logAction({
      actorAdminId: req.user?.id,
      actorUsername: req.user?.username,
      action: 'permission.denied',
      method: req.method,
      route: req.originalUrl,
      permission,
      status: 'denied',
      ip: requestIp(req),
      details: { reason: 'missing_permission' },
    });

    res.status(403).json({ error: `Missing permission: ${permission}` });
  };
};

export const login = async (store: PortsideStore, req: Request, res: Response) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ip = requestIp(req);

  if (!username || !password) {
    store.recordAuthAttempt(username, ip, false, 'missing_credentials');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (!store.hasOwner()) {
    return res.status(428).json({ error: 'First-run setup required', setupRequired: true });
  }

  if (store.countRecentFailedAuth(username, ip) >= 8) {
    store.recordAuthAttempt(username, ip, false, 'rate_limited');
    store.logAction({
      actorUsername: username,
      action: 'auth.rate_limited',
      method: req.method,
      route: req.originalUrl,
      status: 'denied',
      ip,
    });
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  const hash = store.getPasswordHash(username);
  const valid = hash ? await bcrypt.compare(password, hash) : false;

  store.recordAuthAttempt(username, ip, valid, valid ? 'success' : 'invalid_credentials');

  if (!valid) {
    store.logAction({
      actorUsername: username,
      action: 'auth.login_failed',
      method: req.method,
      route: req.originalUrl,
      status: 'denied',
      ip,
    });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const admin = store.getAdminByUsername(username);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const { token, user } = createSessionForAdmin(store, admin.id);

  store.logAction({
    actorAdminId: admin.id,
    actorUsername: admin.username,
    action: 'auth.login',
    method: req.method,
    route: req.originalUrl,
    status: 'success',
    ip,
  });

  res.json({ token, user: sanitizeUser(user) });
};

export const logout = (store: PortsideStore, req: AuthedRequest, res: Response) => {
  if (req.user && !isDebugMode()) {
    store.revokeSession(req.user.sessionId);
    store.logAction({
      actorAdminId: req.user.id,
      actorUsername: req.user.username,
      action: 'auth.logout',
      method: req.method,
      route: req.originalUrl,
      status: 'success',
      ip: requestIp(req),
    });
  }

  res.json({ success: true });
};

export const createOwner = async (store: PortsideStore, req: Request, res: Response) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const result = await createOwnerSession(store, {
    username,
    password,
    method: req.method,
    route: req.originalUrl,
    ip: requestIp(req),
  });
  if ('error' in result) {
    return res.status(result.status ?? 400).json({ error: result.error });
  }
  res.status(201).json(result.payload);
};

export const createOwnerSession = async (
  store: PortsideStore,
  input: { username: string; password: string; method: string; route: string; ip: string },
) => {
  if (store.hasOwner()) return { status: 409, error: 'Setup has already been completed' } as const;

  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(input.username)) {
    return { status: 400, error: 'Username must be 3-40 characters and use letters, numbers, dot, dash, or underscore' } as const;
  }

  if (input.password.length < 10) {
    return { status: 400, error: 'Password must be at least 10 characters' } as const;
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const admin = store.createOwner(input.username, passwordHash);
  if (!admin) return { status: 500, error: 'Failed to create owner admin' } as const;

  const { token, user } = createSessionForAdmin(store, admin.id);

  store.logAction({
    actorAdminId: admin.id,
    actorUsername: admin.username,
    action: 'setup.owner_created',
    method: input.method,
    route: input.route,
    status: 'success',
    ip: input.ip,
  });

  return {
    payload: { token, user: sanitizeUser(user), adminId: admin.id },
  } as const;
};
