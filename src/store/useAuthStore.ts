import { create } from 'zustand';

interface User {
  username: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const isDebug = (import.meta as any).env?.VITE_DEBUG === 'true';

export const useAuthStore = create<AuthState>((set) => ({
  token: isDebug ? 'debug-token' : localStorage.getItem('portside_token'),
  user: isDebug ? { username: 'admin', role: 'owner' } : null,
  isAuthenticated: isDebug || !!localStorage.getItem('portside_token'),
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
