import type { Request } from 'express';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User {
      id: string;
      role: 'viewer' | 'admin';
      email: string;
      name?: string | null;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};
