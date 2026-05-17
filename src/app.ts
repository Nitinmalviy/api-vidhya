import 'express-async-errors';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import router from './routes';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
const vercelAllowedOrigins = new Set([
  'https://vidhya-care.vercel.app',
  'https://docter-vidhya.vercel.app',
  'https://admin-vidhya.vercel.app',
  'https://patient-vidhya.vercel.app',
  'https://chat-vidhya.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
]);

const allowedOrigins = new Set<string>([...vercelAllowedOrigins]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.use('/', router);

app.use(notFound);
app.use(errorHandler);

export default app;
