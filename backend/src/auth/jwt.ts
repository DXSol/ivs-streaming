import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export type Role = 'viewer' | 'admin';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
  iss?: string;
}

export function signAccessToken(payload: { userId: string; email: string; role: Role }) {
  const tokenPayload: JwtPayload = {
    sub: payload.userId,
    email: payload.email,
    role: payload.role,
    iss: env.jwtIssuer,
  };

  return jwt.sign(tokenPayload, env.jwtSecret, {
    expiresIn: '7d',
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret, {
    issuer: env.jwtIssuer,
  }) as JwtPayload;
}
