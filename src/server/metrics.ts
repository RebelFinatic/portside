import os from 'os';

const startedAt = Date.now();
let lastCpu = process.cpuUsage();
let lastSampleAt = process.hrtime.bigint();
let lastPercent = 0;

const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

export const sampleRuntimeMetrics = () => {
  const currentCpu = process.cpuUsage();
  const currentAt = process.hrtime.bigint();
  const elapsedMicros = Number(currentAt - lastSampleAt) / 1000;
  const cpuMicros = (currentCpu.user - lastCpu.user) + (currentCpu.system - lastCpu.system);

  if (elapsedMicros > 0) {
    lastPercent = Math.max(0, Math.min(100, Math.round((cpuMicros / elapsedMicros) * 100)));
  }

  lastCpu = currentCpu;
  lastSampleAt = currentAt;

  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  return {
    process: {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      uptime: formatUptime(Math.floor((Date.now() - startedAt) / 1000)),
      cpuUsage: lastPercent,
      memoryBytes: memory.rss,
      memoryUsage: Math.round((memory.rss / totalMemory) * 100),
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
    },
    host: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg(),
      totalMemoryBytes: totalMemory,
      freeMemoryBytes: freeMemory,
      memoryUsage: Math.round(((totalMemory - freeMemory) / totalMemory) * 100),
      uptimeSeconds: Math.floor(os.uptime()),
      uptime: formatUptime(Math.floor(os.uptime())),
    },
  };
};
