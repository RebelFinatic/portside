import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import type { MemoryLog } from './types';

export type LogFamily = 'admin' | 'fxserver' | 'server';

export interface LogQuery {
  family?: LogFamily;
  limit?: number;
  query?: string;
  level?: string;
  source?: string;
}

const logFamilies = new Set<LogFamily>(['admin', 'fxserver', 'server']);

const dataPath = () => path.resolve(process.env.PORTSIDE_DATA_PATH || '.portside');

const safeLimit = (limit = 100) => Math.max(1, Math.min(Number(limit) || 100, 1000));

const parseLogLine = (line: string) => {
  try {
    return JSON.parse(line) as MemoryLog & { family?: LogFamily };
  } catch {
    return null;
  }
};

export class MemoryLogger {
  private logs: MemoryLog[] = [];
  private root: string;

  constructor() {
    this.root = path.join(dataPath(), 'logs');
    for (const family of logFamilies) {
      mkdirSync(path.join(this.root, family), { recursive: true });
    }
  }

  private filePath(family: LogFamily, date = new Date()) {
    const file = `${date.toISOString().slice(0, 10)}.log`;
    return path.join(this.root, family, file);
  }

  private write(family: LogFamily, log: MemoryLog) {
    appendFileSync(this.filePath(family), `${JSON.stringify({ ...log, family })}\n`, 'utf8');
  }

  cleanup(retentionDays = Number(process.env.PORTSIDE_LOG_RETENTION_DAYS || 14)) {
    const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    for (const family of logFamilies) {
      const dir = path.join(this.root, family);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.log')) continue;
        const target = path.join(dir, file);
        if (statSync(target).mtimeMs < cutoff) unlinkSync(target);
      }
    }
  }

  add(level: string, message: string, source = 'system', family: LogFamily = 'server') {
    const timestamp = new Date().toISOString();
    const log = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp,
      level,
      message,
      source,
      family,
    };

    this.logs.push(log);
    if (this.logs.length > 500) this.logs.shift();
    this.write(family, log);
    console.log(`[${timestamp}] [${level}] [${source}] ${message}`);
    return log;
  }

  recent(limit = 100) {
    return this.logs.slice(-limit).reverse();
  }

  search(input: LogQuery = {}) {
    const limit = safeLimit(input.limit);
    const query = input.query?.trim().toLowerCase();
    const level = input.level && input.level !== 'ALL' ? input.level : null;
    const source = input.source && input.source !== 'ALL' ? input.source : null;
    const families = input.family ? [input.family] : Array.from(logFamilies);

    const entries = families.flatMap(family => this.readFamily(family, Math.max(limit * 4, 200)));
    return entries
      .filter(log => !level || log.level === level)
      .filter(log => !source || log.source === source)
      .filter(log => !query || `${log.message} ${log.level} ${log.source}`.toLowerCase().includes(query))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  listFiles(family: LogFamily) {
    const dir = path.join(this.root, family);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const stats = statSync(path.join(dir, file));
        return { file, family, size: stats.size, updatedAt: stats.mtime.toISOString() };
      })
      .sort((a, b) => b.file.localeCompare(a.file));
  }

  resolveFile(family: LogFamily, file: string) {
    if (!logFamilies.has(family) || !/^\d{4}-\d{2}-\d{2}\.log$/.test(file)) return null;
    const target = path.join(this.root, family, file);
    if (!existsSync(target)) return null;
    return target;
  }

  private readFamily(family: LogFamily, limit: number) {
    const files = this.listFiles(family).slice(0, 7).reverse();
    const entries: Array<MemoryLog & { family: LogFamily }> = [];
    for (const file of files) {
      const target = this.resolveFile(family, file.file);
      if (!target) continue;
      const lines = readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const parsed = parseLogLine(line);
        if (parsed) entries.push({ ...parsed, family });
      }
    }
    return entries.slice(-limit);
  }
}
