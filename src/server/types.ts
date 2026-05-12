import type { Request } from 'express';

export interface AuthUser {
  id: string;
  username: string;
  roleId: string;
  role: string;
  permissions: string[];
  sessionId: string;
  isOwner: boolean;
}

export type AuthedRequest = Request & {
  user?: AuthUser;
};

export interface MemoryLog {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  source: string;
  family?: 'admin' | 'fxserver' | 'server';
}
