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

export function requireRole(roles: Array<'viewer' | 'admin' | 'superadmin' | 'finance-admin' | 'content-admin'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const adminRoles = ['admin', 'superadmin', 'finance-admin', 'content-admin'];
  if (!adminRoles.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  return next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Super admin access required' });
  return next();
}

export function requireFullAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Full admin access required' });
  return next();
}

export function requireFinanceAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const financeRoles = ['superadmin', 'admin', 'finance-admin'];
  if (!financeRoles.includes(req.user.role)) return res.status(403).json({ error: 'Finance admin access required' });
  return next();
}

export function requireContentAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const contentRoles = ['superadmin', 'admin', 'content-admin'];
  if (!contentRoles.includes(req.user.role)) return res.status(403).json({ error: 'Content admin access required' });
  return next();
}
