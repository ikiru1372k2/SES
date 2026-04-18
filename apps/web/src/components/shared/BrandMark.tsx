import logoUrl from '../../../assets/Logo.png';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src={logoUrl} alt="msg" className={compact ? 'h-7 w-auto' : 'h-8 w-auto'} />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-[0.08em] text-gray-950 dark:text-white">SES</div>
        {!compact ? <div className="text-[11px] text-gray-500 dark:text-gray-400">Smart Escalation System</div> : null}
      </div>
    </div>
  );
}
