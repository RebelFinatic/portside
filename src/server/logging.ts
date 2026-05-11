import type { MemoryLog } from './types';

export class MemoryLogger {
  private logs: MemoryLog[] = [];

  add(level: string, message: string, source = 'system') {
    const timestamp = new Date().toISOString();
    const log = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp,
      level,
      message,
      source,
    };

    this.logs.push(log);
    if (this.logs.length > 500) this.logs.shift();
    console.log(`[${timestamp}] [${level}] [${source}] ${message}`);
    return log;
  }

  recent(limit = 100) {
    return this.logs.slice(-limit).reverse();
  }
}
