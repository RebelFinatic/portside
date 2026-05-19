import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { User, Lock, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { apiFetch } from '../lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/setup/status')
      .then(data => {
        if (data.setupRequired) {
          setSetupRequired(true);
          navigate('/onboarding');
        }
      })
      .catch(() => {});
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const { token, user } = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      login(token, user);
      toast.success('Authentication successful');
      navigate('/');
    } catch (error: any) {
      if (error.message?.includes('setup')) {
        navigate('/onboarding');
      } else {
        toast.error(error.message || 'Authentication failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden bg-[#0a0a0a]">
      {/* Background elements */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <div className="w-[600px] h-[600px] bg-orange-600 opacity-5 filter blur-[120px] rounded-full pointer-events-none"></div>
      </div>

      <div className="relative z-10 w-full max-w-[380px] p-8 bg-[#111] border border-zinc-800 rounded-xl shadow-2xl">
        <div className="text-center mb-8">
           <div className="w-16 h-16 mx-auto bg-zinc-100 rounded-xl flex items-center justify-center mb-6 shadow-lg shadow-black/40 border border-white/10">
             <img
               src="/portside-logo.svg"
               alt=""
               aria-hidden="true"
               className="h-12 w-10 object-contain"
             />
           </div>
           <h2 className="text-xl font-bold tracking-tight text-white uppercase m-0">Portside</h2>
           <p className="text-[10px] font-bold text-zinc-500 mt-2 uppercase tracking-widest">Server Operations Console</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-4 w-4 text-zinc-500" />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 border border-zinc-800 rounded bg-zinc-900 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                placeholder="Username"
                required
              />
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-zinc-500" />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 border border-zinc-800 rounded bg-zinc-900 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                placeholder="Password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2.5 px-4 rounded bg-orange-600/10 text-orange-500 border border-orange-600/30 text-xs font-bold uppercase tracking-wider hover:bg-orange-600/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Authenticate'}
          </button>
        </form>

        {setupRequired && (
        <div className="mt-6 text-center text-xs text-zinc-500">
            First-run setup is required. <Link to="/onboarding" className="text-orange-500 hover:text-orange-400">Open setup wizard</Link>
          </div>
        )}
      </div>
    </div>
  );
}
