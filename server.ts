import 'dotenv/config';
import { startServer } from './src/server/app';

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
