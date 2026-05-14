import { NavLink } from 'react-router-dom';
import { Activity, LayoutDashboard, Users, TerminalSquare, Database, FileCode2, Settings, ShieldCheck, FileText, BadgeCheck, PackageOpen } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/useAuthStore';

const navigation = [
  { name: 'Live Terminal', to: '/console', icon: TerminalSquare, permission: 'console.view' },
  { name: 'Players', to: '/players', icon: Users },
  { name: 'Script Manager', to: '/resources', icon: FileCode2, permission: 'commands.resources' },
  { name: 'Role Management', to: '/roles', icon: ShieldCheck, permission: 'manage.admins' },
  { name: 'Whitelist', to: '/whitelist', icon: BadgeCheck, permission: 'players.whitelist' },
  { name: 'Recipe Deployer', to: '/deployer', icon: PackageOpen, permission: 'control.server' },
  { name: 'Logs', to: '/logs', icon: FileText, permission: 'txadmin.log.view' },
];
const infrastructure = [
  { name: 'Dashboard', to: '/', icon: LayoutDashboard },
  { name: 'MariaDB Explorer', to: '/database', icon: Database, permission: 'database.read' },
  { name: 'Diagnostics', to: '/diagnostics', icon: Activity, permission: 'settings.view' },
];

export default function Sidebar() {
  const { user, hasPermission } = useAuthStore();
  const visibleNavigation = navigation.filter(item => !item.permission || hasPermission(item.permission));
  const visibleInfrastructure = infrastructure.filter(item => !item.permission || hasPermission(item.permission));
  
  return (
    <aside className="w-64 bg-[#0d0d0d] border-r border-zinc-800/50 flex flex-col hidden md:flex shrink-0">
      <div className="p-6 flex items-center gap-3">
        <div className="w-9 h-9 bg-zinc-100 rounded-lg flex items-center justify-center border border-white/10 shadow-sm">
          <img
            src="/portside-logo.svg"
            alt=""
            aria-hidden="true"
            className="h-7 w-6 object-contain"
          />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-white uppercase">Portside</h1>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2 ml-2">Core Control</div>
        {visibleNavigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors border',
                isActive
                  ? 'bg-orange-600/10 text-orange-500 border-orange-600/20'
                  : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-white border-transparent'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    'flex-shrink-0 h-4 w-4 transition-colors',
                    isActive ? 'text-orange-500' : 'text-zinc-400'
                  )}
                />
                <span className="text-sm font-medium">{item.name}</span>
              </>
            )}
          </NavLink>
        ))}

        <div className="pt-6 text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2 ml-2">Infrastructure</div>
        {visibleInfrastructure.map((item) => (
          <NavLink
            key={item.name}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors border',
                isActive
                  ? 'bg-orange-600/10 text-orange-500 border-orange-600/20'
                  : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-white border-transparent'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn(
                    'flex-shrink-0 h-4 w-4 transition-colors',
                    isActive ? 'text-orange-500' : 'text-zinc-400'
                  )}
                />
                <span className="text-sm font-medium">{item.name}</span>
              </>
            )}
          </NavLink>
        ))}
        {hasPermission('server.cfg.editor') && (
        <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 px-3 py-2 mt-2 rounded-lg transition-colors border',
                isActive
                  ? 'bg-orange-600/10 text-orange-500 border-orange-600/20'
                  : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-white border-transparent'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Settings
                  className={cn(
                    'flex-shrink-0 h-4 w-4 transition-colors',
                    isActive ? 'text-orange-500' : 'text-zinc-400'
                  )}
                />
                <span className="text-sm font-medium">Configuration</span>
              </>
            )}
        </NavLink>
        )}
      </nav>
      
      <div className="p-4 border-t border-zinc-800/50 bg-black/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white uppercase">
            {user?.username?.substring(0,2) || 'AD'}
          </div>
          <div className="flex-1">
            <div className="text-xs font-semibold text-white">{user?.username || 'Administrator'}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-semibold">{user?.role || 'Super Admin'}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
