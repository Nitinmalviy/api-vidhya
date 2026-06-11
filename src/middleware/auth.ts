import { Response, NextFunction } from 'express';
import { AuthRequest, UserRole } from '../types';
import { verifyAccessToken } from '../utils/jwt';
import { UnauthorizedError, ForbiddenError } from '../utils/AppError';
import { Patient } from '../models/Patient';
import { Doctor } from '../models/Doctor';

const SESSION_REPLACED_MSG = 'You signed in on another device, so this session has ended.';

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('No token provided');
  const payload = verifyAccessToken(header.split(' ')[1]);

  // Single-session enforcement: tokens carry the session version they were
  // issued with; a newer login bumps the user's version, ending older sessions.
  // Tokens issued before this feature (no `sv`) are allowed through until the
  // user logs in again.
  if (payload.sv !== undefined) {
    if (payload.role === 'user') {
      const patient = await Patient.findById(payload.id).select('sessionVersion').lean();
      if (!patient) throw new UnauthorizedError('Account no longer exists');
      if ((patient.sessionVersion ?? 0) !== payload.sv) {
        throw new UnauthorizedError(SESSION_REPLACED_MSG);
      }
    } else if (payload.role === 'doctor') {
      const doctor = await Doctor.findById(payload.id).select('sessionVersion').lean();
      if (!doctor) throw new UnauthorizedError('Account no longer exists');
      if ((doctor.sessionVersion ?? 0) !== payload.sv) {
        throw new UnauthorizedError(SESSION_REPLACED_MSG);
      }
    }
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
