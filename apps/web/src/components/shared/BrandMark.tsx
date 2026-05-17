import logoUrl from '../../../assets/Logo.png';

// The logo artwork is dark "msg global" type on a transparent ground, so on
// dark surfaces we sit it on a small white pill — this keeps the brand red
// intact rather than inverting it to an off-colour.
const LOGO_IMG =
  'h-auto w-auto object-contain dark:rounded-md dark:bg-white dark:p-1';

/**
 * Single canonical brand lockup used everywhere (header, dashboard, auth):
 * msg global logo · divider · "SES" / "Smart Escalation System".
 * `compact` only trims the logo height so it fits the 52px header.
 */
export function BrandMarkHeader() {
  return <BrandMark compact />;
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-label="SES — Smart Escalation System">
      <img
        src={logoUrl}
        alt="msg global"
        className={`${compact ? 'max-h-8' : 'max-h-10'} ${LOGO_IMG}`}
      />
      <span aria-hidden className="h-7 w-px shrink-0 bg-rule dark:bg-gray-700" />
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-[0.12em] text-gray-950 dark:text-white">
          SES
        </span>
        <span className="text-[11px] font-normal tracking-normal text-gray-500 dark:text-gray-400">
          Smart Escalation System
        </span>
      </div>
    </div>
  );
}
