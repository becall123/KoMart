import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import { transactionService } from '@/services';
import type {
  BackfillSaleLinePayload,
  BackfillSalesRequestPayload,
  BackfillVariancePayload,
  ListQueryParams,
  TransactionUpdatePayload,
} from '@/types';
import { invalidateCommerceQueries } from '@/hooks/invalidateCommerce';

export function useTransactions(params?: ListQueryParams) {
  return useQuery({
    queryKey: [...QUERY_KEYS.transactions, params],
    queryFn: () => transactionService.getAll(params),
    placeholderData: keepPreviousData,
  });
}

export function useTransaction(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.transaction(id),
    queryFn: () => transactionService.getById(id),
    enabled: !!id,
  });
}

export function useBackfillSales() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BackfillSalesRequestPayload) => transactionService.backfill(payload),
    onSuccess: () => {
      invalidateCommerceQueries(queryClient, { scopes: ['sale', 'stock'] });
    },
  });
}

export function useValidateBackfillSales() {
  return useMutation({
    mutationFn: (lines: BackfillSaleLinePayload[]) => transactionService.validateBackfill(lines),
  });
}

export function usePostBackfillVariance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BackfillVariancePayload) => transactionService.postBackfillVariance(payload),
    onSuccess: () => {
      invalidateCommerceQueries(queryClient, { scopes: ['sale'] });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wallets });
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
    } & TransactionUpdatePayload) => transactionService.update(id, payload),
    onSuccess: (_, { id }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.transaction(id) });
      invalidateCommerceQueries(queryClient, { scopes: ['sale'] });
    },
  });
}

export function useVoidTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      transactionService.void(id, reason),
    onSuccess: () => {
      // Void restocks inventory — refresh product/inventory lists as well as sale caches.
      invalidateCommerceQueries(queryClient, { scopes: ['sale', 'stock'] });
    },
  });
}
