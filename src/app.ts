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
  'http://localhost:8081',
]);

const allowedOrigins = new Set<string>([...vercelAllowedOrigins]);
const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/;
function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname.endsWith('.vercel.app')) return true;
    if (hostname === 'vidhyacare.in' || hostname.endsWith('.vidhyacare.in')) return true;
    if (PRIVATE_HOST_RE.test(hostname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, isAllowedOrigin(origin));
  },
  credentials: true,
});

app.use(corsMiddleware);
app.options('*', corsMiddleware);
// Razorpay signs the exact bytes it sends, so this path must NOT be JSON-parsed.
// Must stay above express.json() to win the match.
app.use('/api/v1/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);
app.use('/', router);
app.use(notFound);
app.use(errorHandler);

export default app;
