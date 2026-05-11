import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Anchor, Loader2, Lock, User } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';

export default function Setup() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const login = useAuthStore(state => state.login);
  const navigate = useNavigate();

  const handleSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const { token, user } = await apiFetch('/setup/admin', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      login(token, user);
      toast.success('Owner admin created');
      navigate('/');
    } catch (error: any) {
      toast.error(error.message || 'Setup failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden bg-[#0a0a0a] px-4">
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <div className="w-[520px] h-[520px] bg-orange-600 opacity-5 filter blur-[120px] rounded-full pointer-events-none" />
      </div>

      <div className="relative z-10 w-full max-w-[420px] rounded-lg border border-zinc-800 bg-[#111] p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-lg border border-orange-600/20 bg-orange-600/10 text-orange-500">
            <Anchor className="h-7 w-7" />
          </div>
          <h1 className="m-0 text-xl font-bold uppercase tracking-tight text-white">First-run setup</h1>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Create the master Portside admin. This account receives full permissions and cannot be demoted from the owner role.
          </p>
        </div>

        <form onSubmit={handleSetup} className="space-y-4">
          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="block w-full rounded border border-zinc-800 bg-zinc-900 py-2.5 pl-10 pr-3 text-sm text-white placeholder-zinc-600 transition-colors focus:border-zinc-500 focus:outline-none"
              placeholder="Owner username"
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="block w-full rounded border border-zinc-800 bg-zinc-900 py-2.5 pl-10 pr-3 text-sm text-white placeholder-zinc-600 transition-colors focus:border-zinc-500 focus:outline-none"
              placeholder="Password (10+ characters)"
              minLength={10}
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="block w-full rounded border border-zinc-800 bg-zinc-900 py-2.5 pl-10 pr-3 text-sm text-white placeholder-zinc-600 transition-colors focus:border-zinc-500 focus:outline-none"
              placeholder="Confirm password"
              minLength={10}
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full justify-center rounded border border-orange-600/30 bg-orange-600/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-orange-500 transition-colors hover:bg-orange-600/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create owner admin'}
          </button>
        </form>
      </div>
    </div>
  );
}
