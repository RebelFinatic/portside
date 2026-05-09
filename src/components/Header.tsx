import { LogOut, Bell } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

export default function Header() {
  const { user, logout } = useAuthStore();

  return (
    <header className="h-16 border-b border-zinc-800/50 bg-[#0a0a0a] flex items-center justify-between px-8 shrink-0">
      <div className="flex gap-8">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <span className="text-xs font-mono uppercase tracking-widest text-zinc-300">Server Active</span>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="mr-6 hidden sm:flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-tight">Status</span>
            <span className="text-sm font-semibold text-white">Online</span>
          </div>
        </div>
        <button className="px-4 py-1.5 bg-zinc-800 text-white rounded text-xs font-bold border border-zinc-700 transition-colors hover:bg-zinc-700">RESTART</button>
        <button onClick={logout} className="px-4 py-1.5 bg-red-600/20 text-red-500 rounded text-xs font-bold border border-red-600/30 transition-colors hover:bg-red-600/30">LOGOUT</button>
      </div>
    </header>
  );
}
