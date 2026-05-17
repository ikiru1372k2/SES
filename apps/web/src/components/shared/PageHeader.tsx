import type { ReactNode } from 'react';

/**
 * In-page hero block (h1 + description + right-aligned actions). Standardizes
 * the near-identical hero markup across Dashboard / ProcessTiles / VersionCompare.
 *
 * This is the *in-page* header — distinct from the app-chrome header rendered by
 * TopBarNew via usePageHeader (breadcrumbs/toolbar). Purely presentational: the
 * page keeps owning all state, handlers, and modals; JSX is passed into slots.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <div className="flex flex-wrap items-center gap-2">
          {typeof title === 'string' ? (
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-white">{title}</h1>
          ) : (
            title
          )}
        </div>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-300">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Section wrapper: eyebrow/title/description + optional actions, then children.
 * Presentational only — callers keep their own guards/state.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-6 ${className}`}>
      {title || description || actions ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="section-title">{title}</h2> : null}
            {description ? <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
