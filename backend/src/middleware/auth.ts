import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../auth/jwt';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;

  if (!token) {
    console.log('Auth failed: No token provided for', req.method, req.path);
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    return next();
  } catch (err) {
    console.log('Auth failed: Invalid token for', req.method, req.path, err);
    return res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
}

export function requireRole(roles: Array<'viewer' | 'admin'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  return next();
}
