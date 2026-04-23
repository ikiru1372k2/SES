import logoUrl from '../../../assets/Logo.png';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2" aria-label="SES — Smart Escalation System">
      <img src={logoUrl} alt="" className={compact ? 'h-7 w-auto' : 'h-8 w-auto'} aria-hidden="true" />
      <div className="flex items-center gap-1.5 leading-tight">
        <span className="text-sm font-semibold tracking-[0.12em] text-gray-950 dark:text-white">SES</span>
        {!compact ? (
          <span className="ml-1 hidden text-[11px] font-normal tracking-normal text-gray-500 sm:inline dark:text-gray-400">
            Smart Escalation System
          </span>
        ) : null}
      </div>
    </div>
  );
}
