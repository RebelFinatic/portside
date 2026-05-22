import type { FxServerManager } from './fxserver';
import type { MemoryLogger } from './logging';
import type { PortsideStore, RestartScheduleRecord } from './store';

type RelayMonitorEvent = (eventName: string, payload: Record<string, unknown>) => Promise<boolean>;

const pad = (value: number) => String(value).padStart(2, '0');

const occurrenceForDay = (timeOfDay: string, date: Date) => {
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  const occurrence = new Date(date);
  occurrence.setHours(hours || 0, minutes || 0, 0, 0);
  return occurrence;
};

export const nextOccurrenceForSchedule = (schedule: RestartScheduleRecord, nowDate = new Date()) => {
  if (schedule.type === 'temporary') {
    return schedule.executeAt ? new Date(schedule.executeAt) : null;
  }

  if (!schedule.timeOfDay) return null;

  const allowedDays = schedule.daysOfWeek?.length ? schedule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];

  for (let offset = 0; offset < 8; offset += 1) {
    const candidateDate = new Date(nowDate);
    candidateDate.setDate(candidateDate.getDate() + offset);
    if (!allowedDays.includes(candidateDate.getDay())) continue;

    const occurrence = occurrenceForDay(schedule.timeOfDay, candidateDate);
    if (offset === 0 && occurrence.getTime() < nowDate.getTime() - 60_000) continue;
    return occurrence;
  }

  return null;
};

export const defaultRestartName = () => {
  const date = new Date();
  return `Temporary restart ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export class RestartScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: PortsideStore,
    private readonly logger: MemoryLogger,
    private readonly fxServer: FxServerManager,
    private readonly relayMonitorEvent: RelayMonitorEvent
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(error => {
        this.logger.add('ERROR', `Restart scheduler tick failed: ${error.message}`, 'scheduler', 'server');
      });
    }, 15_000);
  }

  async tick(nowDate = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      for (const schedule of this.store.listRestartSchedules()) {
        if (!schedule.enabled) continue;
        const occurrence = nextOccurrenceForSchedule(schedule, nowDate);
        if (!occurrence) continue;
        const occurrenceAt = occurrence.toISOString();
        if (this.store.isRestartSkipped(schedule.id, occurrenceAt)) continue;

        const secondsRemaining = Math.floor((occurrence.getTime() - nowDate.getTime()) / 1000);
        if (secondsRemaining > 0) {
          await this.emitWarnings(schedule, occurrenceAt, secondsRemaining);
          continue;
        }

        if (secondsRemaining >= -45 && this.store.markRestartEvent(schedule.id, occurrenceAt, 'execute')) {
          await this.executeRestart(schedule, occurrenceAt);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async emitWarnings(schedule: RestartScheduleRecord, occurrenceAt: string, secondsRemaining: number) {
    for (const minutes of schedule.warningMinutes) {
      const targetSeconds = minutes * 60;
      if (secondsRemaining > targetSeconds || secondsRemaining <= targetSeconds - 20) continue;
      const marker = `warn:${minutes}`;
      if (!this.store.markRestartEvent(schedule.id, occurrenceAt, marker)) continue;
      const translatedMessage = schedule.message || `Scheduled restart in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
      await this.relayMonitorEvent('scheduledRestart', {
        secondsRemaining,
        translatedMessage,
      });
      this.logger.add('WARN', translatedMessage, 'scheduler', 'admin');
      this.store.logAction({
        action: 'server.restart.warning',
        permission: 'control.server',
        status: 'success',
        details: { scheduleId: schedule.id, occurrenceAt, secondsRemaining, message: translatedMessage },
      });
    }
  }

  private async executeRestart(schedule: RestartScheduleRecord, occurrenceAt: string) {
    const message = schedule.message || 'Scheduled restart by Portside';
    if (!this.fxServer.isManagedMode()) {
      this.logger.add('WARN', 'Scheduled restart skipped because managed FXServer mode is not enabled.', 'scheduler', 'server');
      this.store.logAction({
        action: 'server.restart.scheduled',
        permission: 'control.server',
        status: 'failed',
        details: { scheduleId: schedule.id, occurrenceAt, error: 'managed mode not enabled' },
      });
      return;
    }

    await this.relayMonitorEvent('serverShuttingDown', {
      delay: 0,
      author: 'Portside',
      message,
    });

    try {
      await this.fxServer.restart(message);
      this.store.logAction({
        action: 'server.restart.scheduled',
        permission: 'control.server',
        status: 'success',
        details: { scheduleId: schedule.id, occurrenceAt },
      });
    } catch (error: any) {
      this.logger.add('WARN', `Scheduled restart could not run: ${error.message}`, 'scheduler', 'server');
      this.store.logAction({
        action: 'server.restart.scheduled',
        permission: 'control.server',
        status: 'failed',
        details: { scheduleId: schedule.id, occurrenceAt, error: error.message },
      });
    }

    if (schedule.type === 'temporary') {
      this.store.updateRestartSchedule(schedule.id, {
        name: schedule.name,
        enabled: false,
        executeAt: schedule.executeAt,
        warningMinutes: schedule.warningMinutes,
        message: schedule.message,
      });
    }
  }
}
