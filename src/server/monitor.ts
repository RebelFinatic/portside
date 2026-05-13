import type { Request, Response, NextFunction } from 'express';
import type { MemoryLogger } from './logging';
import type { PortsideStore } from './store';

export const MONITOR_VERSION = '0.1.3';

const allowedRelayEvents = new Set([
  'announcement',
  'playerKicked',
  'playerBanned',
  'playerWarned',
  'playerDirectMessage',
  'consoleCommand',
  'configChanged',
  'serverShuttingDown',
  'scheduledRestart',
  'scheduledRestartSkipped',
]);

export const requireMonitorToken = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.PORTSIDE_MONITOR_TOKEN;
  const provided = req.header('x-portside-monitor-token');

  if (!expected) {
    res.status(503).json({ error: 'Monitor bridge is not configured' });
    return;
  }

  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'Invalid monitor token' });
    return;
  }

  next();
};

export const safeEventName = (eventName: string) => /^[a-zA-Z][a-zA-Z0-9_.:-]{0,80}$/.test(eventName);

export const createMonitorEventRelay = (
  store: PortsideStore,
  logger: MemoryLogger,
  runRconCommand: (command: string) => Promise<string>
) => {
  return async (eventName: string, payload: Record<string, unknown>) => {
    if (!allowedRelayEvents.has(eventName)) {
      store.logMonitorEvent({ eventName, direction: 'outbound', status: 'skipped', payload: { reason: 'unsupported event' } });
      return false;
    }

    if (!safeEventName(eventName)) {
      store.logMonitorEvent({ eventName, direction: 'outbound', status: 'rejected', payload: { reason: 'invalid event name' } });
      return false;
    }

    const encodedPayload = JSON.stringify(payload);
    const status = store.getMonitorStatus();
    if (!status.configured || !status.online) {
      store.logMonitorEvent({
        eventName,
        direction: 'outbound',
        status: 'skipped',
        payload: { reason: status.configured ? 'monitor offline' : 'monitor bridge not configured' },
      });
      return false;
    }

    try {
      await runRconCommand(`psaEvent ${eventName} ${encodedPayload}`);
      store.logMonitorEvent({ eventName, direction: 'outbound', status: 'success', payload });
      return true;
    } catch (error: any) {
      logger.add('WARN', `Monitor event relay unavailable for ${eventName}: ${error.message}`, 'monitor', 'server');
      store.logMonitorEvent({ eventName, direction: 'outbound', status: 'failed', payload: { error: error.message } });
      return false;
    }
  };
};
