import { Toaster } from 'react-hot-toast';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthGate } from './components/auth/AuthGate';
import { CompareProcesses } from './components/dashboard/CompareProcesses';
import { Dashboard } from './pages/Dashboard';
import { Debug } from './pages/Debug';
import { Login } from './pages/Login';
import { ManagerResponse } from './pages/ManagerResponse';
import { ProcessTiles } from './pages/ProcessTiles';
import { VersionCompare } from './pages/VersionCompare';
import { Workspace } from './pages/Workspace';
import { DEFAULT_FUNCTION_ID } from '@ses/domain';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Preserve deep links made before the tile flow shipped. */
function LegacyWorkspaceRedirect() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" replace />;
  return <Navigate to={`/processes/${encodeURIComponent(id)}/${DEFAULT_FUNCTION_ID}`} replace />;
}

/** Same — for /workspace/:id/compare. */
function LegacyCompareRedirect() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" replace />;
  return <Navigate to={`/processes/${encodeURIComponent(id)}/${DEFAULT_FUNCTION_ID}/compare`} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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

          {/* Process tile dashboard — the new landing page after create. */}
          <Route
            path="/processes/:processId"
            element={
              <AuthGate>
                <ProcessTiles />
              </AuthGate>
            }
          />
          {/* Function-scoped workspace (the single reusable Workspace surface). */}
          <Route
            path="/processes/:processId/:functionId"
            element={
              <AuthGate>
                <Workspace />
              </AuthGate>
            }
          />
          <Route
            path="/processes/:processId/:functionId/compare"
            element={
              <AuthGate>
                <VersionCompare />
              </AuthGate>
            }
          />

          {/* Legacy compatibility. Kept through one release. */}
          <Route
            path="/workspace/:id"
            element={
              <AuthGate>
                <LegacyWorkspaceRedirect />
              </AuthGate>
            }
          />
          <Route
            path="/workspace/:id/compare"
            element={
              <AuthGate>
                <LegacyCompareRedirect />
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
    </QueryClientProvider>
  );
}
