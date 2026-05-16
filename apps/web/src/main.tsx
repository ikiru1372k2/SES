import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { installCsrfHeader } from './lib/api/installCsrfHeader';
import './index.css';

// F7: must run before any API call. Adds X-Requested-With to same-origin
// requests so the server-side CsrfGuard accepts our SPA traffic.
installCsrfHeader();

// The pre-React splash lives inside #root and is replaced when React renders.
// To avoid a flash / layout shift on the handoff we keep a sibling overlay
// node out of #root, fade it after first paint, then remove it.
function dismissSplash() {
  const splash = document.getElementById('ses-splash');
  if (!splash) return;
  // Two rAFs ⇒ the React tree has painted at least one frame before we fade.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.style.transition = 'opacity 200ms ease';
      splash.style.opacity = '0';
      splash.style.pointerEvents = 'none';
      window.setTimeout(() => splash.remove(), 220);
    }),
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

dismissSplash();
