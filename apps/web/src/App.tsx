import { Toaster } from 'react-hot-toast';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_FUNCTION_ID } from '@ses/domain';
import type { ReactNode } from 'react';
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

type ProtectedRouteDefinition = {
  path: string;
  element: ReactNode;
};

function ProtectedRoute({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}

function renderProtectedRoutes(routes: ProtectedRouteDefinition[]) {
  return routes.map(({ path, element }) => (
    <Route key={path} path={path} element={<ProtectedRoute>{element}</ProtectedRoute>} />
  ));
}

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

const tilesDashboardRoutes: ProtectedRouteDefinition[] = [
  { path: '/processes/:processId', element: <ProcessTiles /> },
  { path: '/processes/:processId/:functionId', element: <Workspace /> },
  { path: '/processes/:processId/:functionId/compare', element: <VersionCompare /> },
  { path: '/workspace/:processId', element: <LegacyWorkspaceRedirect /> },
  { path: '/workspace/:processId/compare', element: <LegacyCompareRedirect /> },
];

const legacyWorkspaceRoutes: ProtectedRouteDefinition[] = [
  { path: '/workspace/:processId', element: <ProcessTiles /> },
  { path: '/workspace/:processId/:functionId', element: <Workspace /> },
  { path: '/workspace/:processId/:functionId/compare', element: <VersionCompare /> },
  { path: '/workspace/:processId/compare', element: <WorkspaceShallowCompareRedirect /> },
  { path: '/processes/:processId', element: <ProcessesDashboardRedirect /> },
  { path: '/processes/:processId/:functionId', element: <ProcessesWorkspaceRedirect /> },
  { path: '/processes/:processId/:functionId/compare', element: <ProcessesCompareRedirect /> },
];

export default function App() {
  const tilesDashboard = isTilesDashboardEnabled();
  const workspaceRoutes = tilesDashboard ? tilesDashboardRoutes : legacyWorkspaceRoutes;

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/respond/:token" element={<ManagerResponse />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {renderProtectedRoutes(workspaceRoutes)}

          <Route
            path="/compare"
            element={
              <ProtectedRoute>
                <CompareProcesses />
              </ProtectedRoute>
            }
          />
          <Route
            path="/debug"
            element={
              <ProtectedRoute>
                <Debug />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
