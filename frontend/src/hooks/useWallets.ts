import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS, STALE_TIME } from '@/constants';
import { walletService } from '@/services';
import type { WalletAdjustmentPayload, WalletTransferPayload } from '@/types';

function ledgerFilterKey(params?: {
  wallet?: string;
  dateFrom?: string;
  dateTo?: string;
  entryType?: string;
  limit?: number;
}) {
  return JSON.stringify(params ?? {});
}

export function useWalletBalances(enabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.walletBalances,
    queryFn: () => walletService.getBalances(),
    enabled,
    staleTime: STALE_TIME.standard,
  });
}

export function useWalletLedger(
  params?: {
    wallet?: string;
    dateFrom?: string;
    dateTo?: string;
    entryType?: string;
    limit?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: QUERY_KEYS.walletLedger(ledgerFilterKey(params)),
    queryFn: () => walletService.getLedger(params),
    enabled,
    staleTime: STALE_TIME.standard,
  });
}

function invalidateWalletQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wallets });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.walletBalances });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports('dailySummary') });
}

export function useWalletTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WalletTransferPayload) => walletService.transfer(payload),
    onSuccess: () => invalidateWalletQueries(queryClient),
  });
}

export function useWalletAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: WalletAdjustmentPayload) => walletService.adjust(payload),
    onSuccess: () => invalidateWalletQueries(queryClient),
  });
}
