import type { Client, TextChannel } from 'discord.js';
import type { MemoryLogger } from './logging';
import type { PortsideStore } from './store';
import type { FxServerManager } from './fxserver';
import { sampleRuntimeMetrics } from './metrics';
import { nextOccurrenceForSchedule } from './scheduler';

export interface DiscordStatusSnapshot {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  lastUpdateAt: string | null;
  lastError: string | null;
}

export class DiscordStatusService {
  private client: Client | null = null;
  private interval: NodeJS.Timeout | null = null;
  private lastUpdateAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly store: PortsideStore,
    private readonly logger: MemoryLogger,
    private readonly fxServer: FxServerManager
  ) {}

  getStatus(): DiscordStatusSnapshot {
    const settings = this.store.getDiscordStatusSettings();
    return {
      configured: Boolean(process.env.PORTSIDE_DISCORD_BOT_TOKEN && settings.guildId && settings.statusChannelId),
      enabled: settings.enabled,
      connected: Boolean(this.client?.isReady()),
      lastUpdateAt: this.lastUpdateAt,
      lastError: this.lastError,
    };
  }

  async start() {
    const settings = this.store.getDiscordStatusSettings();
    const token = process.env.PORTSIDE_DISCORD_BOT_TOKEN;
    if (this.client?.isReady()) return;
    if (!token || !settings.enabled || !settings.guildId || !settings.statusChannelId) {
      this.logger.add('INFO', 'Discord status bot disabled or incomplete', 'discord', 'server');
      return;
    }

    try {
      const { Client, GatewayIntentBits } = await import('discord.js');
      this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
      this.client.once('ready', () => {
        this.logger.add('INFO', 'Discord status bot connected', 'discord', 'server');
        this.updateStatusEmbed();
      });
      await this.client.login(token);
      this.interval = setInterval(() => this.updateStatusEmbed(), settings.updateIntervalSeconds * 1000);
    } catch (error: any) {
      this.lastError = error.message;
      this.logger.add('WARN', `Discord status bot could not start: ${error.message}`, 'discord', 'server');
    }
  }

  async updateStatusEmbed() {
    const settings = this.store.getDiscordStatusSettings();
    if (!settings.enabled || !this.client?.isReady() || !settings.statusChannelId) return;

    try {
      const channel = await this.client.channels.fetch(settings.statusChannelId);
      if (!channel || !('send' in channel)) throw new Error('Configured Discord status channel is not text-capable');

      const metrics = sampleRuntimeMetrics();
      const monitor = this.store.getMonitorStatus() as any;
      const fxserver = this.fxServer.getStatus();
      const nextRestart = this.store.listRestartSchedules()
        .filter(schedule => schedule.enabled)
        .map(schedule => nextOccurrenceForSchedule(schedule))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime())[0];

      const embed = {
        title: 'Portside Server Status',
        color: fxserver.state === 'online' || monitor.online ? 0x22c55e : 0xf97316,
        fields: [
          { name: 'Server', value: monitor.serverName || 'FiveM Server', inline: true },
          { name: 'State', value: fxserver.state || (monitor.online ? 'online' : 'offline'), inline: true },
          { name: 'Players', value: `${monitor.players ?? this.store.listMonitorPlayers().length}/${monitor.maxPlayers || 64}`, inline: true },
          { name: 'Monitor', value: monitor.online ? `online${monitor.version ? ` (${monitor.version})` : ''}` : 'offline', inline: true },
          { name: 'Portside Uptime', value: `${Math.floor(metrics.process.uptimeSeconds / 60)}m`, inline: true },
          { name: 'Next Restart', value: nextRestart ? nextRestart.toLocaleString() : 'not scheduled', inline: true },
        ],
        timestamp: new Date().toISOString(),
      };

      if (settings.statusMessageId && 'messages' in channel) {
        const message = await (channel as TextChannel).messages.fetch(settings.statusMessageId);
        await message.edit({ embeds: [embed] });
      } else {
        const message = await (channel as TextChannel).send({ embeds: [embed] });
        this.store.updateDiscordStatusSettings({ ...settings, statusMessageId: message.id });
      }

      this.lastUpdateAt = new Date().toISOString();
      this.lastError = null;
    } catch (error: any) {
      this.lastError = error.message;
      this.logger.add('WARN', `Discord status update failed: ${error.message}`, 'discord', 'server');
    }
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.client?.destroy();
    this.client = null;
  }
}
