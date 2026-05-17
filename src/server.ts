import app from './app';
import { env } from './config/env';
import { connectDB } from './config/database';
import { configureCloudinary } from './config/cloudinary';
import { logger } from './utils/logger';

configureCloudinary();
connectDB().catch((err: Error) => logger.error({ err }, 'DB connection failed'));

// Local development only — Vercel handles the HTTP server in production
if (!process.env.VERCEL) {
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
  });

  process.on('unhandledRejection', (err: Error) => {
    logger.error({ err }, 'Unhandled rejection');
    server.close(() => process.exit(1));
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

export default app;
