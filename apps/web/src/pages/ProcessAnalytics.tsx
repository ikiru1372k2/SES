import { useParams } from 'react-router-dom';
import { AnalyticsWorkbench } from '../components/analytics/AnalyticsWorkbench';

export default function ProcessAnalytics() {
  const { processId } = useParams<{ processId: string }>();
  if (!processId) return <div className="p-6 text-sm text-gray-500">Missing process id.</div>;
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-gray-500">Whole process — across all functions. Ask the analyst, browse trends, drill into anomalies.</p>
      </div>
      <AnalyticsWorkbench processCode={processId} />
    </div>
  );
}
