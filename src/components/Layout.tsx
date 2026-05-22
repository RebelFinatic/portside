import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem('portside.sidebarCollapsed');
    if (storedValue === 'true') {
      setSidebarCollapsed(true);
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const nextValue = !prev;
      window.localStorage.setItem('portside.sidebarCollapsed', String(nextValue));
      return nextValue;
    });
  };

  return (
    <div className="flex h-screen bg-[#0a0a0a] overflow-hidden text-zinc-300 font-sans w-full">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
