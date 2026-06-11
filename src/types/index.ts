import { Request } from 'express';
import { Types } from 'mongoose';

export type UserRole = 'user' | 'doctor' | 'admin';

export interface JwtPayload {
  id: string;
  role: UserRole;
  /** Session version — bumped on every login so older sessions are invalidated. */
  sv?: number;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export type ObjectId = Types.ObjectId;