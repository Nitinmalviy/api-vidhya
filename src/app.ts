import 'express-async-errors';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import router from './routes';
import dns from 'dns';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

const app = express();
dns.setServers(['8.8.8.8', '8.8.4.4','1.1.1.1', '1.0.0.1']);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
const vercelAllowedOrigins = new Set([
  // Production custom domain
  'https://vidhyacare.in',
  'https://www.vidhyacare.in',
  // Vercel preview URLs
  'https://vidhya-care.vercel.app',
  'https://vidhya-landing-page.vercel.app',
  'https://docter-vidhya.vercel.app',
  'https://admin-vidhya.vercel.app',
  'https://patient-vidhya.vercel.app',
  'https://chat-vidhya.vercel.app',
  // Local dev
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
]);

const allowedOrigins = new Set<string>([...vercelAllowedOrigins]);

// Allow the curated list, any *.vercel.app preview, and the production domain.
function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname.endsWith('.vercel.app')) return true;
    if (hostname === 'vidhyacare.in' || hostname.endsWith('.vidhyacare.in')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

const corsMiddleware = cors({
  origin(origin, callback) {
    // No origin (mobile apps, curl, server-to-server) → allow
    if (!origin) return callback(null, true);
    // Reflect the origin if allowed; otherwise DON'T throw (throwing → 500 with no
    // CORS headers, which the browser reports as a confusing "CORS error").
    return callback(null, isAllowedOrigin(origin));
  },
  credentials: true,
});

app.use(corsMiddleware);
// Make sure preflight requests are answered with CORS headers
app.options('*', corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

app.use('/', router);

app.use(notFound);
app.use(errorHandler);

export default app;
