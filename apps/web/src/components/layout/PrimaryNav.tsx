import { NavLink } from 'react-router-dom';
import { useCurrentUser } from '../auth/authContext';

export function PrimaryNav({ className = '' }: { className?: string }) {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';

  return (
    <nav className={`flex items-center gap-0.5 ${className}`} aria-label="Primary">
      <GlobalNavLink to="/" end label="Dashboard" />
      <GlobalNavLink to="/compare" label="Compare" />
      {isAdmin ? <GlobalNavLink to="/admin/directory" label="Directory" /> : null}
      {isAdmin ? <GlobalNavLink to="/admin/templates" label="Templates" /> : null}
    </nav>
  );
}

function GlobalNavLink({ to, label, end = false }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-brand-subtle text-brand dark:bg-brand/20 dark:text-brand'
            : 'text-ink-2 hover:bg-surface-app hover:text-ink dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
        }`
      }
    >
      {label}
    </NavLink>
  );
}
