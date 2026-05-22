import { NavLink } from 'react-router-dom';
import {
  Activity,
  LayoutDashboard,
  Users,
  TerminalSquare,
  Database,
  FileCode2,
  Settings,
  ShieldCheck,
  FileText,
  BadgeCheck,
  PackageOpen,
  ArrowUpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
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
  { name: 'Updates', to: '/updates', icon: ArrowUpCircle, permission: 'settings.view' },
  { name: 'Configuration', to: '/settings', icon: Settings, permission: 'server.cfg.editor' },
];

type SidebarContentProps = {
  collapsed: boolean;
  showLabels: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
};

export function SidebarContent({ collapsed, showLabels, onToggle, onNavigate }: SidebarContentProps) {
  const { user, hasPermission } = useAuthStore();
  const visibleNavigation = navigation.filter(item => !item.permission || hasPermission(item.permission));
  const visibleInfrastructure = infrastructure.filter(item => !item.permission || hasPermission(item.permission));

  const linkProps = (item: { name: string; to: string }) => ({
    to: item.to,
    title: collapsed ? item.name : undefined,
    onClick: onNavigate,
  });

  return (
    <>
      <div className={cn('flex items-center', collapsed ? 'p-4 justify-center' : 'p-6 gap-3')}>
        <div className={cn('bg-zinc-100 rounded-lg flex items-center justify-center border border-white/10 shadow-sm', collapsed ? 'w-10 h-10' : 'w-9 h-9')}>
          <img src="/portside-logo.svg" alt="" aria-hidden="true" className="h-7 w-6 object-contain" />
        </div>
        {showLabels && <h1 className="text-xl font-bold tracking-tight text-white uppercase">Portside</h1>}
      </div>

      {onToggle && (
        <div className={cn('mb-3', collapsed ? 'px-3' : 'px-4')}>
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              'w-full rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800/70 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]',
              collapsed ? 'h-9 flex items-center justify-center' : 'px-3 py-2 text-xs font-semibold uppercase tracking-wide flex items-center gap-2'
            )}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {showLabels && <span>Collapse</span>}
          </button>
        </div>
      )}

      <nav className={cn('flex-1 space-y-1 overflow-y-auto', collapsed ? 'px-3' : 'px-4')}>
        {showLabels ? (
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2 ml-2">Core Control</div>
        ) : (
          <div className="mx-2 mb-2 border-t border-zinc-800/80" aria-hidden="true" />
        )}
        {visibleNavigation.map(item => (
          <NavLink
            key={item.name}
            {...linkProps(item)}
            className={({ isActive }) =>
              cn(
                'group flex items-center rounded-lg transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]',
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2',
                isActive
                  ? 'bg-orange-600/10 text-orange-500 border-orange-600/20'
                  : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-white border-transparent'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn('flex-shrink-0 h-4 w-4 transition-colors', isActive ? 'text-orange-500' : 'text-zinc-400')} />
                {showLabels && <span className="text-sm font-medium">{item.name}</span>}
              </>
            )}
          </NavLink>
        ))}

        {showLabels ? (
          <div className="pt-6 text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2 ml-2">Infrastructure</div>
        ) : (
          <div className="mx-2 my-3 border-t border-zinc-800/80" aria-hidden="true" />
        )}
        {visibleInfrastructure.map(item => (
          <NavLink
            key={item.name}
            {...linkProps(item)}
            className={({ isActive }) =>
              cn(
                'group flex items-center rounded-lg transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]',
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2',
                isActive
                  ? 'bg-orange-600/10 text-orange-500 border-orange-600/20'
                  : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-white border-transparent'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn('flex-shrink-0 h-4 w-4 transition-colors', isActive ? 'text-orange-500' : 'text-zinc-400')} />
                {showLabels && <span className="text-sm font-medium">{item.name}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={cn('border-t border-zinc-800/50 bg-black/20 shrink-0', collapsed ? 'p-3' : 'p-4')}>
        <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
          <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white uppercase">
            {user?.username?.substring(0, 2) || 'AD'}
          </div>
          {showLabels && (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white truncate">{user?.username || 'Administrator'}</div>
              <div className="text-[10px] text-zinc-500 uppercase font-semibold truncate">{user?.role || 'Super Admin'}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

export default function Sidebar({ collapsed, onToggle, mobileOpen = false, onMobileClose }: SidebarProps) {
  const showLabels = !collapsed;

  return (
    <>
      <aside
        className={cn(
          'bg-[#0d0d0d] border-r border-zinc-800/50 flex-col shrink-0 transition-all duration-200 hidden md:flex',
          collapsed ? 'w-20' : 'w-64'
        )}
      >
        <SidebarContent collapsed={collapsed} showLabels={showLabels} onToggle={onToggle} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={onMobileClose}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(280px,85vw)] flex-col bg-[#0d0d0d] border-r border-zinc-800/50 shadow-2xl">
            <div className="flex items-center justify-end p-3 border-b border-zinc-800/50">
              <button
                type="button"
                onClick={onMobileClose}
                className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent collapsed={false} showLabels onNavigate={onMobileClose} />
          </aside>
        </div>
      )}
    </>
  );
}
