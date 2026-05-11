import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import { PortsideStore } from './store';
import { MemoryLogger } from './logging';
import { registerApiRoutes } from './routes';
import { RealtimeHub } from './realtime';

export async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORTSIDE_PORT || 3000);
  const store = new PortsideStore();
  const logger = new MemoryLogger();
  const realtime = new RealtimeHub();

  app.use(express.json());
  logger.add('INFO', 'Portside Server starting...');

  registerApiRoutes(app, store, logger, realtime);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = createHttpServer(app);
  realtime.attach(server, store);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Portside running on http://localhost:${PORT}`);
    logger.add('INFO', `Web panel ready on port ${PORT}`);
  });
}
