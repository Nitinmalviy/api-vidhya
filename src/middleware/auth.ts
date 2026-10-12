import { Response, NextFunction } from 'express';
import { AuthRequest, UserRole } from '../types';
import { verifyAccessToken } from '../utils/jwt';
import { UnauthorizedError, ForbiddenError } from '../utils/AppError';
import { Patient } from '../models/Patient';
import { Doctor } from '../models/Doctor';

const SESSION_ENDED_MSG =
  'Your session has ended because you signed in on another device or changed your password. Please sign in again.';

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('No token provided');
  const payload = verifyAccessToken(header.split(' ')[1]);

  // Single-session enforcement: tokens carry the session version they were
  // issued with; a newer login or a password change bumps the user's version,
  // ending older sessions. Patient/doctor tokens without `sv` predate this and
  // are refused, so a password change really does sign everyone else out.
  if (payload.role === 'user' || payload.role === 'doctor') {
    if (payload.sv === undefined) throw new UnauthorizedError('Your session has ended. Please sign in again.');
    const account =
      payload.role === 'user'
        ? await Patient.findById(payload.id).select('sessionVersion').lean()
        : await Doctor.findById(payload.id).select('sessionVersion').lean();
    if (!account) throw new UnauthorizedError('Account no longer exists');
    if ((account.sessionVersion ?? 0) !== payload.sv) throw new UnauthorizedError(SESSION_ENDED_MSG);
  }

  req.user = payload;
  next();
};

export const authorize =
  (...roles: UserRole[]) =>
  (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.role)) throw new ForbiddenError('Insufficient permissions');
    next();
  };
