import dgram from 'dgram';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import type { MemoryLogger } from './logging';

export const fetchFiveMJson = async (endpoint: string) => {
  if (!process.env.FIVEM_SERVER_URL) {
    throw new Error('FIVEM_SERVER_URL is not configured');
  }

  const response = await fetch(`${process.env.FIVEM_SERVER_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`FiveM request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const getServerConfigPath = () => {
  if (!process.env.FIVEM_SERVER_CFG_PATH) {
    throw new Error('FIVEM_SERVER_CFG_PATH is not configured');
  }

  return path.resolve(process.env.FIVEM_SERVER_CFG_PATH);
};

const getRconConfig = () => {
  if (!process.env.FIVEM_RCON_PASSWORD) {
    throw new Error('FIVEM_RCON_PASSWORD is not configured');
  }

  const serverUrl = process.env.FIVEM_SERVER_URL ? new URL(process.env.FIVEM_SERVER_URL) : null;
  const serverHost = serverUrl?.hostname === 'localhost' ? '127.0.0.1' : serverUrl?.hostname;

  return {
    host: process.env.FIVEM_RCON_HOST || serverHost || '127.0.0.1',
    port: Number(process.env.FIVEM_RCON_PORT || serverUrl?.port || 30120),
    password: process.env.FIVEM_RCON_PASSWORD,
  };
};

export const sendRconCommand = (command: string) => new Promise<string>((resolve, reject) => {
  const config = getRconConfig();
  const socket = dgram.createSocket('udp4');
  let settled = false;

  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    socket.close();
    callback();
  };

  const timeout = setTimeout(() => {
    settle(() => reject(new Error('RCON request timed out')));
  }, 5000);

  socket.once('message', data => {
    clearTimeout(timeout);
    const output = data.subarray(4).toString('utf8').trim();
    if (/bad rcon/i.test(output)) {
      settle(() => reject(new Error('RCON authentication failed')));
      return;
    }

    settle(() => resolve(output.replace(/^print\n?/, '').trim()));
  });

  socket.on('error', err => {
    clearTimeout(timeout);
    settle(() => reject(err));
  });

  const payload = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff]),
    Buffer.from(`rcon ${config.password} ${command}`, 'utf8'),
  ]);

  socket.send(payload, config.port, config.host, err => {
    if (err) {
      clearTimeout(timeout);
      settle(() => reject(err));
    }
  });
});

export const createRconRunner = (logger: MemoryLogger) => {
  return async (command: string) => {
    logger.add('COMMAND', command, 'rcon', 'fxserver');
    const output = await sendRconCommand(command);
    logger.add('INFO', output || `RCON command completed: ${command}`, 'rcon', 'fxserver');
    return output;
  };
};

export const assertSafeResourceName = (name: string) => {
  if (!/^[\w.-]+$/.test(name)) {
    throw new Error('Invalid resource name');
  }
};

export const readServerConfig = async () => {
  const configPath = getServerConfigPath();
  return { content: await readFile(configPath, 'utf8'), path: configPath };
};

export const writeServerConfig = async (content: string) => {
  const configPath = getServerConfigPath();
  await writeFile(configPath, content, 'utf8');
  return configPath;
};
