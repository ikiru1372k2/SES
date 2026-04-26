import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Modal } from '../shared/Modal';
import { useDismissWelcome, useWelcomeState } from '../../hooks/useAiPilot';
import { useCurrentUser } from '../auth/authContext';

export function WelcomeModal() {
  const user = useCurrentUser();
  const state = useWelcomeState();
  const dismiss = useDismissWelcome();

  if (user?.role !== 'admin') return null;
  if (state.isLoading || !state.data) return null;
  if (state.data.aiPilotWelcomeDismissed) return null;

  const close = () => dismiss.mutate();

  return (
    <Modal
      open
      onClose={close}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={16} className="text-brand" />
          Meet AI Pilot
        </span>
      }
      description="A new way to author audit rules — admin-only"
      footer={
        <>
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700"
          >
            Maybe later
          </button>
          <Link
            to="/admin/ai-pilot"
            onClick={close}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            <Sparkles size={14} />
            Try it
          </Link>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
        <p>
          AI Pilot lets you author audit rules in plain English. Upload a sample workbook,
          describe what should be flagged, preview the result, and confirm. The rule then runs on
          every future audit alongside the hardcoded engines.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-300">
          <li>Production data is never touched while you build a rule.</li>
          <li>Mandatory preview against your sample before save.</li>
          <li>Pause or archive any rule from the AI Pilot list at any time.</li>
        </ul>
        <p className="text-xs text-gray-500">
          You won&apos;t see this again. Open AI Pilot from the dashboard whenever you need it.
        </p>
      </div>
    </Modal>
  );
}
