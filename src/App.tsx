import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuthStore } from './store/useAuthStore';
import { apiFetch } from './lib/api';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Players from './pages/Players';
import Console from './pages/Console';
import Resources from './pages/Resources';
import Database from './pages/Database';
import Configuration from './pages/Configuration';
import Roles from './pages/Roles';
import Layout from './components/Layout';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const { isAuthenticated, logout } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      // Verify token immediately
      apiFetch('/auth/verify').catch(() => {
        logout();
      });
    }
  }, [isAuthenticated, logout]);

  return (
    <>
      <Toaster theme="dark" position="top-right" />
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="players" element={<Players />} />
            <Route path="console" element={<Console />} />
            <Route path="resources" element={<Resources />} />
            <Route path="database" element={<Database />} />
            <Route path="settings" element={<Configuration />} />
            <Route path="roles" element={<Roles />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </>
  );
}
