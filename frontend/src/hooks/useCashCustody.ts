import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS, STALE_TIME } from '@/constants';
import { cashCustodyService } from '@/services';
import type {
  CashCustodyDepositPayload,
  CashCustodyReturnPayload,
  CashCustodyTakePayload,
} from '@/types';

function listFilterKey(params?: { status?: string; heldByUserId?: string }) {
  return JSON.stringify(params ?? {});
}

function invalidateCustody(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cashCustodies });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wallets });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.walletBalances });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports('dailySummary') });
}

export function useCashCustodySummary(enabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.cashCustodySummary,
    queryFn: () => cashCustodyService.summary(),
    enabled,
    staleTime: STALE_TIME.standard,
  });
}

export function useCashCustodies(
  params?: { status?: string; heldByUserId?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: QUERY_KEYS.cashCustodyList(listFilterKey(params)),
    queryFn: () => cashCustodyService.list(params),
    enabled,
    staleTime: STALE_TIME.standard,
  });
}

export function useTakeCashCustody() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CashCustodyTakePayload) => cashCustodyService.take(payload),
    onSuccess: () => invalidateCustody(queryClient),
  });
}

export function useReturnCashCustody() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CashCustodyReturnPayload }) =>
      cashCustodyService.returnToTill(id, payload),
    onSuccess: () => invalidateCustody(queryClient),
  });
}

export function useDepositCashCustody() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CashCustodyDepositPayload }) =>
      cashCustodyService.deposit(id, payload),
    onSuccess: () => invalidateCustody(queryClient),
  });
}
