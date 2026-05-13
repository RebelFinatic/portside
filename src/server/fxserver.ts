import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import type { MemoryLogger } from './logging';

export type FxServerLifecycleState = 'external' | 'stopped' | 'starting' | 'online' | 'stopping' | 'restarting' | 'crashed';

export interface FxServerStatus {
  mode: 'external' | 'managed';
  state: FxServerLifecycleState;
  enabled: boolean;
  pid: number | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  crashCount: number;
  restartOnCrash: boolean;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  lastExitReason: string | null;
  binaryConfigured: boolean;
  cwdConfigured: boolean;
}

const parseBoolean = (value: string | undefined, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
};

const splitArgs = (input: string | undefined) => {
  if (!input) return [];
  const matches = input.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return matches.map(part => part.replace(/^"|"$/g, ''));
};

const resolveServerCfgPath = () => {
  if (!process.env.FIVEM_SERVER_CFG_PATH) return null;
  return path.resolve(process.env.FIVEM_SERVER_CFG_PATH);
};

const argsReferenceDefaultConfig = (args: string[]) => {
  const execIndex = args.findIndex(arg => arg.toLowerCase() === '+exec' || arg.toLowerCase() === 'exec');
  if (execIndex === -1) return args.length === 0;
  const configArg = args[execIndex + 1];
  return !configArg || configArg === 'server.cfg';
};

const createLineWriter = (
  logger: MemoryLogger,
  level: string,
  source: string,
  family: 'fxserver'
) => {
  let buffer = '';

  const flushLine = (line: string) => {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed) logger.add(level, trimmed, source, family);
  };

  return {
    write(chunk: Buffer | string) {
      buffer += chunk.toString();
      const lines = buffer.split(/\n/);
      buffer = lines.pop() || '';
      lines.forEach(flushLine);
    },
    flush() {
      flushLine(buffer);
      buffer = '';
    },
  };
};

export class FxServerManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private state: FxServerLifecycleState;
  private startedAt: Date | null = null;
  private crashCount = 0;
  private lastExitCode: number | null = null;
  private lastExitSignal: string | null = null;
  private lastExitReason: string | null = null;
  private intentionalStop = false;
  private stopTimer: NodeJS.Timeout | null = null;

  constructor(private readonly logger: MemoryLogger) {
    this.state = this.isManagedMode() ? 'stopped' : 'external';
  }

  isManagedMode() {
    return (process.env.PORTSIDE_FXSERVER_MODE || 'external').toLowerCase() === 'managed';
  }

  private restartOnCrash() {
    return parseBoolean(process.env.PORTSIDE_FXSERVER_RESTART_ON_CRASH, false);
  }

  private stopTimeoutMs() {
    return Math.max(1000, Number(process.env.PORTSIDE_FXSERVER_STOP_TIMEOUT_MS || 10000));
  }

  private assertManaged() {
    if (!this.isManagedMode()) {
      throw new Error('Managed FXServer mode is not enabled. Set PORTSIDE_FXSERVER_MODE=managed to use lifecycle controls.');
    }
    if (!process.env.PORTSIDE_FXSERVER_BINARY) {
      throw new Error('PORTSIDE_FXSERVER_BINARY is required for managed FXServer mode.');
    }
  }

  getStatus(): FxServerStatus {
    const uptimeSeconds = this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : null;
    return {
      mode: this.isManagedMode() ? 'managed' : 'external',
      state: this.isManagedMode() ? this.state : 'external',
      enabled: this.isManagedMode(),
      pid: this.child?.pid || null,
      startedAt: this.startedAt?.toISOString() || null,
      uptimeSeconds,
      crashCount: this.crashCount,
      restartOnCrash: this.restartOnCrash(),
      lastExitCode: this.lastExitCode,
      lastExitSignal: this.lastExitSignal,
      lastExitReason: this.lastExitReason,
      binaryConfigured: Boolean(process.env.PORTSIDE_FXSERVER_BINARY),
      cwdConfigured: Boolean(process.env.PORTSIDE_FXSERVER_CWD),
    };
  }

  async start(reason = 'Started from Portside') {
    this.assertManaged();
    if (this.child) return this.getStatus();

    const binary = path.resolve(process.env.PORTSIDE_FXSERVER_BINARY!);
    const configuredArgs = splitArgs(process.env.PORTSIDE_FXSERVER_ARGS);
    const serverCfgPath = resolveServerCfgPath();
    const serverCfgDir = serverCfgPath ? path.dirname(serverCfgPath) : null;
    let cwd = process.env.PORTSIDE_FXSERVER_CWD ? path.resolve(process.env.PORTSIDE_FXSERVER_CWD) : (serverCfgDir || path.dirname(binary));
    let args = configuredArgs.length > 0 ? configuredArgs : (serverCfgPath ? ['+exec', path.basename(serverCfgPath)] : []);

    if (serverCfgPath && argsReferenceDefaultConfig(args) && !existsSync(path.join(cwd, path.basename(serverCfgPath)))) {
      this.logger.add('WARN', `Managed FXServer cwd did not contain ${path.basename(serverCfgPath)}; using FIVEM_SERVER_CFG_PATH directory instead.`, 'fxserver', 'fxserver');
      cwd = serverCfgDir!;
      args = ['+exec', path.basename(serverCfgPath)];
    }

    this.intentionalStop = false;
    this.state = 'starting';
    this.lastExitReason = reason;
    this.logger.add('INFO', `Starting managed FXServer: ${binary}`, 'fxserver', 'fxserver');
    this.logger.add('INFO', `Managed FXServer working directory: ${cwd}`, 'fxserver', 'fxserver');
    this.child = spawn(binary, args, { cwd, windowsHide: true });
    this.startedAt = new Date();
    this.state = 'online';
    const stdoutWriter = createLineWriter(this.logger, 'INFO', 'stdout', 'fxserver');
    const stderrWriter = createLineWriter(this.logger, 'ERROR', 'stderr', 'fxserver');

    this.child.stdout.on('data', chunk => {
      stdoutWriter.write(chunk);
    });
    this.child.stderr.on('data', chunk => {
      stderrWriter.write(chunk);
    });
    this.child.on('error', error => {
      this.lastExitReason = error.message;
      this.logger.add('ERROR', `Managed FXServer process error: ${error.message}`, 'fxserver', 'fxserver');
    });
    this.child.on('exit', (code, signal) => {
      stdoutWriter.flush();
      stderrWriter.flush();
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      this.lastExitCode = code;
      this.lastExitSignal = signal;
      const shouldRestart = !this.intentionalStop && this.restartOnCrash();
      this.child = null;
      this.startedAt = null;
      this.state = this.intentionalStop ? 'stopped' : 'crashed';
      if (!this.intentionalStop) this.crashCount += 1;
      this.logger.add(this.intentionalStop ? 'INFO' : 'ERROR', `Managed FXServer exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`, 'fxserver', 'fxserver');

      if (shouldRestart) {
        windowlessDelay(() => {
          this.start('Automatic restart after crash').catch(error => {
            this.logger.add('ERROR', `Automatic FXServer restart failed: ${error.message}`, 'fxserver', 'fxserver');
          });
        }, 2000);
      }
    });

    return this.getStatus();
  }

  async stop(reason = 'Stopped from Portside') {
    this.assertManaged();
    if (!this.child) {
      this.state = 'stopped';
      return this.getStatus();
    }

    this.intentionalStop = true;
    this.state = 'stopping';
    this.lastExitReason = reason;
    this.logger.add('WARN', `Stopping managed FXServer: ${reason}`, 'fxserver', 'fxserver');
    this.child.kill('SIGTERM');

    this.stopTimer = setTimeout(() => {
      if (this.child) {
        this.logger.add('WARN', 'Managed FXServer did not exit before timeout; forcing process kill.', 'fxserver', 'fxserver');
        this.child.kill('SIGKILL');
      }
    }, this.stopTimeoutMs());

    return this.waitForState(['stopped', 'crashed'], this.stopTimeoutMs() + 1500);
  }

  async restart(reason = 'Restarted from Portside', delayMs = 0) {
    this.assertManaged();
    this.state = 'restarting';
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    if (this.child) {
      await this.stop(reason);
    }
    return this.start(reason);
  }

  private async waitForState(states: FxServerLifecycleState[], timeoutMs: number) {
    const started = Date.now();
    while (!states.includes(this.state) && Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.getStatus();
  }
}

const windowlessDelay = (callback: () => void, delayMs: number) => {
  setTimeout(callback, delayMs);
};
