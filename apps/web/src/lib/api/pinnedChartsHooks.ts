import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchDefaultCharts,
  fetchPinnedCharts,
  pinChart,
  reorderPinnedCharts,
  unpinChart,
  type PinChartInput,
  type PinnedChart,
} from './analyticsApi';
import type { FunctionId } from '@ses/domain';

const key = (processCode: string) => ['pinned-charts', processCode] as const;

/** Deterministic seed charts (no LLM) — always shown atop the workbench. */
export function useDefaultCharts(processCode: string, functionId?: FunctionId) {
  return useQuery({
    queryKey: ['default-charts', processCode, functionId ?? null] as const,
    queryFn: () => fetchDefaultCharts(processCode, functionId),
    staleTime: 60_000,
  });
}

export function usePinnedCharts(processCode: string) {
  return useQuery({
    queryKey: key(processCode),
    queryFn: () => fetchPinnedCharts(processCode),
  });
}

export function usePinChart(processCode: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PinChartInput) => pinChart(processCode, input),
    onSuccess: (pinned) => {
      // Append to the cached list so the workbench updates without a refetch.
      qc.setQueryData<PinnedChart[]>(key(processCode), (prev) =>
        prev ? [...prev, pinned] : [pinned],
      );
      toast.success('Pinned to workbench');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to pin chart'),
  });
}

export function useUnpinChart(processCode: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unpinChart(processCode, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key(processCode) });
      const prev = qc.getQueryData<PinnedChart[]>(key(processCode));
      qc.setQueryData<PinnedChart[]>(key(processCode), (cur) =>
        (cur ?? []).filter((c) => c.id !== id),
      );
      return { prev };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key(processCode), ctx.prev);
      toast.error(e instanceof Error ? e.message : 'Failed to unpin chart');
    },
  });
}

export function useReorderPinnedCharts(processCode: string) {
  const qc = useQueryClient();
  return useMutation({
    // The caller has already optimistically set the new order in cache; this
    // just persists it. `orderedIds` is the full top-first id list.
    mutationFn: (orderedIds: string[]) => reorderPinnedCharts(processCode, orderedIds),
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed to save order');
      void qc.invalidateQueries({ queryKey: key(processCode) });
    },
  });
}
