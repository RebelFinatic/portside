import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
import Layout from './components/Layout';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const { isAuthenticated, login, logout, token } = useAuthStore();

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
    }
  }, [isAuthenticated, login, logout, token]);

  return (
    <>
      <Toaster theme="dark" position="top-right" />
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </>
  );
}
