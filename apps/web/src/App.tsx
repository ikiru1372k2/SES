import { Toaster } from 'react-hot-toast';
import {
  Navigate,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useParams,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_FUNCTION_ID } from '@ses/domain';
import type { ReactNode } from 'react';
import { AuthGate } from './components/auth/AuthGate';
import { ConfirmProvider } from './components/shared/ConfirmProvider';
import { ScopedErrorBoundary } from './components/shared/ScopedErrorBoundary';
import { CompareProcesses } from './components/dashboard/CompareProcesses';
import { PageHeaderProvider } from './components/layout/PageHeaderContext';
import { Dashboard } from './pages/Dashboard';
import { Debug } from './pages/Debug';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { ManagerResponse } from './pages/ManagerResponse';
import { AdminDirectory } from './pages/AdminDirectory';
import { AdminRoute } from './components/auth/AdminRoute';
import { AiPilotShell } from './pages/ai-pilot/AiPilotShell';
import { EscalationCenter } from './pages/EscalationCenter';
import { EscalationTemplateAdmin } from './pages/EscalationTemplateAdmin';
import { ProcessTiles } from './pages/ProcessTiles';
import ProcessAnalytics from './pages/ProcessAnalytics';
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
  return (
    <AuthGate>
      <PageHeaderProvider>{children}</PageHeaderProvider>
    </AuthGate>
  );
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
  { path: '/processes/:processId/escalations', element: <ScopedErrorBoundary label="Escalation Center"><EscalationCenter /></ScopedErrorBoundary> },
  { path: '/processes/:processId/analytics', element: <ScopedErrorBoundary label="Analytics"><ProcessAnalytics /></ScopedErrorBoundary> },
  { path: '/processes/:processId/:functionId', element: <Workspace /> },
  { path: '/processes/:processId/:functionId/compare', element: <VersionCompare /> },
  { path: '/workspace/:processId', element: <LegacyWorkspaceRedirect /> },
  { path: '/workspace/:processId/compare', element: <LegacyCompareRedirect /> },
];

const legacyWorkspaceRoutes: ProtectedRouteDefinition[] = [
  { path: '/workspace/:processId', element: <ProcessTiles /> },
  { path: '/workspace/:processId/escalations', element: <ScopedErrorBoundary label="Escalation Center"><EscalationCenter /></ScopedErrorBoundary> },
  { path: '/workspace/:processId/analytics', element: <ScopedErrorBoundary label="Analytics"><ProcessAnalytics /></ScopedErrorBoundary> },
  { path: '/workspace/:processId/:functionId', element: <Workspace /> },
  { path: '/workspace/:processId/:functionId/compare', element: <VersionCompare /> },
  { path: '/workspace/:processId/compare', element: <WorkspaceShallowCompareRedirect /> },
  { path: '/processes/:processId', element: <ProcessesDashboardRedirect /> },
  { path: '/processes/:processId/:functionId', element: <ProcessesWorkspaceRedirect /> },
  { path: '/processes/:processId/:functionId/compare', element: <ProcessesCompareRedirect /> },
];

function buildRouter() {
  const tilesDashboard = isTilesDashboardEnabled();
  const workspaceRoutes = tilesDashboard ? tilesDashboardRoutes : legacyWorkspaceRoutes;
  return createBrowserRouter(
    createRoutesFromElements(
      <>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/respond/:token" element={<ManagerResponse />} />
        <Route
          path="/admin/templates"
          element={
            <ProtectedRoute>
              <EscalationTemplateAdmin />
            </ProtectedRoute>
          }
        />
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
        <Route
          path="/admin/directory"
          element={
            <ProtectedRoute>
              <AdminDirectory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/ai-pilot"
          element={
            <AdminRoute>
              <AiPilotShell />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/ai-pilot/:functionId"
          element={
            <AdminRoute>
              <AiPilotShell />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </>,
    ),
  );
}

// Build once at module load so the router (and its history stack) isn't
// thrown away on every App re-render. Data routers are stateful — creating
// a fresh one per render would drop blocker state and loader data.
const router = buildRouter();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
        {/* Bottom-right avoids overlap with the TopBar's Save / Run actions,
            which live top-right. Top-center was the pre-B6 default and the
            toasts routinely covered the very buttons that triggered them. */}
        <Toaster position="bottom-right" />
      </ConfirmProvider>
    </QueryClientProvider>
  );
}
