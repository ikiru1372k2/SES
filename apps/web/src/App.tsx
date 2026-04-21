import { Toaster } from 'react-hot-toast';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_FUNCTION_ID } from '@ses/domain';
import { AuthGate } from './components/auth/AuthGate';
import { CompareProcesses } from './components/dashboard/CompareProcesses';
import { Dashboard } from './pages/Dashboard';
import { Debug } from './pages/Debug';
import { Login } from './pages/Login';
import { ManagerResponse } from './pages/ManagerResponse';
import { ProcessTiles } from './pages/ProcessTiles';
import { VersionCompare } from './pages/VersionCompare';
import { Workspace } from './pages/Workspace';
import { isTilesDashboardEnabled } from './lib/processRoutes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function LegacyWorkspaceRedirect() {
  const { processId } = useParams<{ processId: string }>();
  if (!processId) return <Navigate to="/" replace />;
  return <Navigate to={`/processes/${encodeURIComponent(processId)}/${DEFAULT_FUNCTION_ID}`} replace />;
}

function LegacyCompareRedirect() {
  const { processId } = useParams<{ processId: string }>();
  if (!processId) return <Navigate to="/" replace />;
  return <Navigate to={`/processes/${encodeURIComponent(processId)}/${DEFAULT_FUNCTION_ID}/compare`} replace />;
}

function WorkspaceShallowCompareRedirect() {
  const { processId } = useParams<{ processId: string }>();
  if (!processId) return <Navigate to="/" replace />;
  return (
    <Navigate to={`/workspace/${encodeURIComponent(processId)}/${DEFAULT_FUNCTION_ID}/compare`} replace />
  );
}

function ProcessesDashboardRedirect() {
  const { processId } = useParams<{ processId: string }>();
  if (!processId) return <Navigate to="/" replace />;
  return <Navigate to={`/workspace/${encodeURIComponent(processId)}`} replace />;
}

function ProcessesWorkspaceRedirect() {
  const { processId, functionId } = useParams<{ processId: string; functionId: string }>();
  if (!processId || !functionId) return <Navigate to="/" replace />;
  return (
    <Navigate
      to={`/workspace/${encodeURIComponent(processId)}/${encodeURIComponent(functionId)}`}
      replace
    />
  );
}

function ProcessesCompareRedirect() {
  const { processId, functionId } = useParams<{ processId: string; functionId: string }>();
  if (!processId || !functionId) return <Navigate to="/" replace />;
  return (
    <Navigate
      to={`/workspace/${encodeURIComponent(processId)}/${encodeURIComponent(functionId)}/compare`}
      replace
    />
  );
}

function TilesDashboardRoutes() {
  return (
    <>
      <Route
        path="/processes/:processId"
        element={
          <AuthGate>
            <ProcessTiles />
          </AuthGate>
        }
      />
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
      <Route
        path="/workspace/:processId"
        element={
          <AuthGate>
            <LegacyWorkspaceRedirect />
          </AuthGate>
        }
      />
      <Route
        path="/workspace/:processId/compare"
        element={
          <AuthGate>
            <LegacyCompareRedirect />
          </AuthGate>
        }
      />
    </>
  );
}

function LegacyWorkspacePrimaryRoutes() {
  return (
    <>
      <Route
        path="/workspace/:processId"
        element={
          <AuthGate>
            <ProcessTiles />
          </AuthGate>
        }
      />
      <Route
        path="/workspace/:processId/:functionId"
        element={
          <AuthGate>
            <Workspace />
          </AuthGate>
        }
      />
      <Route
        path="/workspace/:processId/:functionId/compare"
        element={
          <AuthGate>
            <VersionCompare />
          </AuthGate>
        }
      />
      <Route
        path="/workspace/:processId/compare"
        element={
          <AuthGate>
            <WorkspaceShallowCompareRedirect />
          </AuthGate>
        }
      />
      <Route
        path="/processes/:processId"
        element={
          <AuthGate>
            <ProcessesDashboardRedirect />
          </AuthGate>
        }
      />
      <Route
        path="/processes/:processId/:functionId"
        element={
          <AuthGate>
            <ProcessesWorkspaceRedirect />
          </AuthGate>
        }
      />
      <Route
        path="/processes/:processId/:functionId/compare"
        element={
          <AuthGate>
            <ProcessesCompareRedirect />
          </AuthGate>
        }
      />
    </>
  );
}

export default function App() {
  const tilesDashboard = isTilesDashboardEnabled();
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/respond/:token" element={<ManagerResponse />} />

          <Route
            path="/"
            element={
              <AuthGate>
                <Dashboard />
              </AuthGate>
            }
          />

          {tilesDashboard ? <TilesDashboardRoutes /> : <LegacyWorkspacePrimaryRoutes />}

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
