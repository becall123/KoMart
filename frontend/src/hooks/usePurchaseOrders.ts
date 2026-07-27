import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants';
import { purchaseOrderService } from '@/services';
import type {
  ListQueryParams,
  PurchaseOrderListResponse,
  PurchaseOrderStatus,
  PurchaseOrderReceiveItem,
  PurchaseOrderWritePayload,
  PurchaseOrderPaymentPayload,
} from '@/types';
import { invalidateCommerceQueries } from '@/hooks/invalidateCommerce';

export function usePurchaseOrders(
  params?: ListQueryParams,
  options?: { enabled?: boolean },
) {
  return useQuery<PurchaseOrderListResponse>({
    queryKey: [...QUERY_KEYS.purchaseOrders, params],
    queryFn: () => purchaseOrderService.getAll(params),
    enabled: options?.enabled ?? true,
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.purchaseOrder(id),
    queryFn: () => purchaseOrderService.getById(id),
    enabled: !!id,
  });
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PurchaseOrderWritePayload) =>
      purchaseOrderService.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrders });
    },
  });
}

export function useUpdatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: PurchaseOrderWritePayload;
    }) => purchaseOrderService.update(id, data),
    onSuccess: (_, { id }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrders });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrder(id) });
    },
  });
}

export function useUpdatePurchaseOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: PurchaseOrderStatus }) =>
      purchaseOrderService.updateStatus(id, status),
    onSuccess: (_, { id }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrders });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrder(id) });
    },
  });
}

export function useReceivePurchaseOrderItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: PurchaseOrderReceiveItem[] }) =>
      purchaseOrderService.receiveItemsInChunks(id, items),
    onSuccess: (_, { id }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrders });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrder(id) });
      invalidateCommerceQueries(queryClient, { scopes: ['stock', 'price'] });
    },
  });
}

export function useRecordPurchaseOrderPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PurchaseOrderPaymentPayload }) =>
      purchaseOrderService.recordPayment(id, data),
    onSuccess: (_, { id }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrders });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchaseOrder(id) });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.expenses });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.expenseStats });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wallets });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.walletBalances });
    },
  });
}
