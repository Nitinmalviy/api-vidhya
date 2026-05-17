import app from './app';
import { env } from './config/env';
import { connectDB } from './config/database';
import { configureCloudinary } from './config/cloudinary';
import { logger } from './utils/logger';

const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
  configureCloudinary();
  await connectDB();
});

process.on('unhandledRejection', (err: Error) => {
  logger.error({ err }, 'Unhandled rejection');
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
