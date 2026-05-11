import { create } from 'zustand';

interface User {
  id: string;
  username: string;
  roleId: string;
  role: string;
  permissions: string[];
  isOwner: boolean;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  hasPermission: (permission: string) => boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const isDebug = (import.meta as any).env?.VITE_DEBUG === 'true';

export const useAuthStore = create<AuthState>((set) => ({
  token: isDebug ? 'debug-token' : localStorage.getItem('portside_token'),
  user: isDebug ? {
    id: 'debug-admin',
    username: 'debug-admin',
    roleId: 'debug-owner',
    role: 'Owner',
    permissions: ['all_permissions'],
    isOwner: true,
  } : null,
  isAuthenticated: isDebug || !!localStorage.getItem('portside_token'),
  hasPermission: (permission) => {
    const user = useAuthStore.getState().user;
    if (!user) return false;
    return user.permissions.includes('all_permissions') || user.permissions.includes(permission);
  },
  login: (token, user) => {
    if (!isDebug) {
      localStorage.setItem('portside_token', token);
    }
    set({ token, user, isAuthenticated: true });
  },
  logout: () => {
    if (isDebug) return; // Prevent logout in debug mode
    localStorage.removeItem('portside_token');
    set({ token: null, user: null, isAuthenticated: false });
  },
}));
