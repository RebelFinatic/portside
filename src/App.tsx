import React, { useCallback, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuthStore } from './store/useAuthStore';
import { apiFetch } from './lib/api';

// Pages
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Players from './pages/Players';
import Console from './pages/Console';
import Resources from './pages/Resources';
import Database from './pages/Database';
import Configuration from './pages/Configuration';
import Roles from './pages/Roles';
import Logs from './pages/Logs';
import Whitelist from './pages/Whitelist';
import Diagnostics from './pages/Diagnostics';
import Deployer from './pages/Deployer';
import Onboarding from './pages/Onboarding';
import Updates from './pages/Updates';
import Layout from './components/Layout';
import { OnboardingStatusContext } from './context/OnboardingStatusContext';

function ProtectedRoute({
  children,
  onboardingRequired,
  onboardingChecked,
}: {
  children: React.ReactNode;
  onboardingRequired: boolean;
  onboardingChecked: boolean;
}) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!onboardingChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a] text-zinc-400">
        Checking onboarding status...
      </div>
    );
  }
  if (onboardingRequired && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

export default function App() {
  const { isAuthenticated, login, logout, token, user } = useAuthStore();
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  const refreshOnboardingStatus = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setOnboardingRequired(false);
      setOnboardingChecked(true);
      return;
    }

    const canControlServer = user.permissions.includes('all_permissions') || user.permissions.includes('control.server');
    if (!user.isOwner || !canControlServer) {
      setOnboardingRequired(false);
      setOnboardingChecked(true);
      return;
    }

    setOnboardingChecked(false);
    try {
      const state = await apiFetch('/onboarding/state');
      setOnboardingRequired(!state.completed && !state.skipped);
    } catch {
      setOnboardingRequired(false);
    } finally {
      setOnboardingChecked(true);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (isAuthenticated) {
      // Verify token immediately
      apiFetch('/auth/verify')
        .then(({ user }) => {
          if (token && user) login(token, user);
        })
        .catch(() => {
          logout();
        });
    } else {
      setOnboardingRequired(false);
      setOnboardingChecked(true);
    }
  }, [isAuthenticated, login, logout, token]);

  useEffect(() => {
    refreshOnboardingStatus();
  }, [refreshOnboardingStatus]);

  return (
    <>
      <Toaster theme="dark" position="top-right" />
      <OnboardingStatusContext.Provider value={{ refreshOnboardingStatus }}>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<ProtectedRoute onboardingRequired={onboardingRequired} onboardingChecked={onboardingChecked}><Layout /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="players" element={<Players />} />
              <Route path="console" element={<Console />} />
              <Route path="resources" element={<Resources />} />
              <Route path="database" element={<Database />} />
              <Route path="settings" element={<Configuration />} />
              <Route path="roles" element={<Roles />} />
              <Route path="logs" element={<Logs />} />
              <Route path="whitelist" element={<Whitelist />} />
              <Route path="diagnostics" element={<Diagnostics />} />
              <Route path="updates" element={<Updates />} />
              <Route path="deployer" element={<Deployer />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Router>
      </OnboardingStatusContext.Provider>
    </>
  );
}
