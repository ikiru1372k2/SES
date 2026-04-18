import { Toaster } from 'react-hot-toast';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthGate } from './components/auth/AuthGate';
import { CompareProcesses } from './components/dashboard/CompareProcesses';
import { Dashboard } from './pages/Dashboard';
import { Debug } from './pages/Debug';
import { Login } from './pages/Login';
import { ManagerResponse } from './pages/ManagerResponse';
import { VersionCompare } from './pages/VersionCompare';
import { Workspace } from './pages/Workspace';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes — no auth required. */}
        <Route path="/login" element={<Login />} />
        <Route path="/respond/:token" element={<ManagerResponse />} />

        {/* Authenticated routes. */}
        <Route
          path="/"
          element={
            <AuthGate>
              <Dashboard />
            </AuthGate>
          }
        />
        <Route
          path="/workspace/:id"
          element={
            <AuthGate>
              <Workspace />
            </AuthGate>
          }
        />
        <Route
          path="/workspace/:id/compare"
          element={
            <AuthGate>
              <VersionCompare />
            </AuthGate>
          }
        />
        <Route
          path="/compare"
          element={
            <AuthGate>
              <CompareProcesses />
            </AuthGate>
          }
        />
        <Route
          path="/debug"
          element={
            <AuthGate>
              <Debug />
            </AuthGate>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" />
    </BrowserRouter>
  );
}
