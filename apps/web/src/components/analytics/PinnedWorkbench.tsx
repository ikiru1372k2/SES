import { useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Download, GripVertical, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ChartSpec } from '@ses/domain';
import {
  useDefaultCharts,
  usePinnedCharts,
  useReorderPinnedCharts,
  useUnpinChart,
} from '../../lib/api/pinnedChartsHooks';
import type { PinnedChart } from '../../lib/api/analyticsApi';
import { exportAllChartsCsv, exportChartCsv } from '../../lib/chartExport';
import { ChartRenderer } from './ChartRenderer';

/** Compact CSV-export icon button for a single chart card. */
function ExportButton({ title, spec }: { title: string; spec: ChartSpec }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!exportChartCsv(title, spec)) toast.error('Nothing to export for this chart');
      }}
      className="rounded p-1 text-ink-3 transition-colors hover:bg-gray-100 hover:text-brand dark:hover:bg-gray-800"
      aria-label={`Export ${title} as CSV`}
      title="Export CSV"
    >
      <Download size={14} />
    </button>
  );
}

/** Static card for a deterministic default chart — no drag/unpin; it's a
 *  live computed baseline, not a user pin. */
function DefaultCard({
  title,
  question,
  spec,
}: {
  title: string;
  question: string;
  spec: ChartSpec;
}) {
  return (
    <div className="surface-card flex flex-col p-3" aria-label={`Default chart: ${title}`}>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold text-ink dark:text-white">
              {title}
            </span>
            <span className="chip chip-plain shrink-0 text-[10px]">live</span>
          </div>
          {question ? (
            <div className="truncate text-[11px] text-ink-3" title={question}>
              {question}
            </div>
          ) : null}
        </div>
        <ExportButton title={title} spec={spec} />
      </div>
      <div className="min-h-0 flex-1">
        <ChartRenderer spec={spec} />
      </div>
    </div>
  );
}

/** Drop target id for the empty slot — chat-pinned charts and the dashboard
 *  card drop here too (handled by the parent's DndContext). */
export const WORKBENCH_DROPPABLE_ID = 'pinned-workbench-dropzone';

function SortableCard({
  chart,
  onUnpin,
}: {
  chart: PinnedChart;
  onUnpin: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: chart.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="surface-card flex flex-col p-3"
      aria-label={`Pinned chart: ${chart.title}`}
    >
      <div className="mb-2 flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none text-ink-3 hover:text-ink active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-ink dark:text-white">
            {chart.title}
          </div>
          {chart.question ? (
            <div className="truncate text-[11px] text-ink-3" title={chart.question}>
              {chart.question}
            </div>
          ) : null}
        </div>
        <ExportButton title={chart.title} spec={chart.chartSpec as ChartSpec} />
        <button
          type="button"
          onClick={() => onUnpin(chart.id)}
          className="rounded p-1 text-ink-3 transition-colors hover:bg-gray-100 hover:text-brand dark:hover:bg-gray-800"
          aria-label={`Unpin ${chart.title}`}
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ChartRenderer spec={chart.chartSpec as ChartSpec} />
      </div>
    </div>
  );
}

function EmptySlot({ hasPins }: { hasPins: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: WORKBENCH_DROPPABLE_ID });
  return (
    <div
      ref={setNodeRef}
      className={`grid place-items-center rounded-xl border border-dashed p-6 text-center transition-colors ${
        isOver
          ? 'border-brand bg-brand/5 text-brand'
          : 'border-rule text-ink-3 dark:border-gray-700'
      } ${hasPins ? 'col-span-full min-h-[140px]' : 'col-span-full min-h-[260px]'}`}
    >
      <div>
        <Plus size={20} className="mx-auto" />
        <div className="mt-2 text-[12.5px]">
          Drag a chart here or pin one from the chat answer
        </div>
      </div>
    </div>
  );
}

export function PinnedWorkbench({ processCode }: { processCode: string }) {
  const { data, isLoading } = usePinnedCharts(processCode);
  const { data: defaults } = useDefaultCharts(processCode);
  const unpin = useUnpinChart(processCode);
  const reorder = useReorderPinnedCharts(processCode);

  // Local drag override so reordering feels instant. We key it to the server
  // list identity: whenever `data` changes (pin/unpin/refetch) the override is
  // discarded and we fall back to server order — no setState-in-effect.
  const [override, setOverride] = useState<{ src: PinnedChart[]; list: PinnedChart[] } | null>(
    null,
  );
  const order = useMemo<PinnedChart[]>(() => {
    const server = data ?? [];
    return override && override.src === server ? override.list : server;
  }, [data, override]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = order.findIndex((c) => c.id === active.id);
    const newIdx = order.findIndex((c) => c.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(order, oldIdx, newIdx);
    setOverride({ src: data ?? [], list: next });
    reorder.mutate(next.map((c) => c.id));
  }

  return (
    <div className="surface-card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-rule px-4 py-3 dark:border-gray-800">
        <div className="text-[13px] font-bold text-ink dark:text-white">
          Pinned workbench
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            const all = [
              ...(defaults ?? []).map((c) => ({ title: c.title, spec: c.spec as ChartSpec })),
              ...order.map((c) => ({ title: c.title, spec: c.chartSpec as ChartSpec })),
            ];
            if (!exportAllChartsCsv(all, `analytics_${processCode}`)) {
              toast.error('No chart data to export yet');
            }
          }}
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-gray-50 hover:text-ink dark:border-gray-600 dark:bg-gray-900 dark:hover:bg-gray-800"
          aria-label="Export all charts as CSV"
          title="Export all charts (CSV)"
        >
          <Download size={13} />
          Export all
        </button>
        <span className="chip chip-plain">
          {(defaults?.length ?? 0) + order.length} chart
          {(defaults?.length ?? 0) + order.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {defaults && defaults.length > 0 ? (
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Process analytics
              </div>
              <span className="text-[11px] text-ink-3">
                · live from uploaded audit data, all functions
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {defaults.map((c) => (
                <DefaultCard
                  key={c.id}
                  title={c.title}
                  question={c.question}
                  spec={c.spec as ChartSpec}
                />
              ))}
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="py-12 text-center text-sm text-ink-3">Loading workbench…</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <SortableContext
                items={order.map((c) => c.id)}
                strategy={rectSortingStrategy}
              >
                {order.map((chart) => (
                  <SortableCard
                    key={chart.id}
                    chart={chart}
                    onUnpin={(id) => unpin.mutate(id)}
                  />
                ))}
              </SortableContext>
              <EmptySlot hasPins={order.length > 0} />
            </div>
          </DndContext>
        )}
      </div>
    </div>
  );
}
