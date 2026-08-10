import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { QUERY_KEYS, STALE_TIME } from '@/constants';
import type { ProductStatus } from '@/types';
import { reportsService, dayCloseService } from '@/services';
import { useDashboardStore } from '@/store';

function useReportDateRange() {
  return useDashboardStore((s) => s.dateRange);
}

function reportQueryOptions<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  enabled = true,
) {
  return {
    queryKey,
    queryFn,
    enabled,
    staleTime: STALE_TIME.reports,
    placeholderData: keepPreviousData,
  } as const;
}

export function useSalesSummary(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('salesSummary'), dateRange],
      () => reportsService.getSalesSummary(dateRange),
      enabled,
    ),
  );
}

export function useSalesByPaymentMethod(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('paymentMethod'), dateRange],
      () => reportsService.getSalesByPaymentMethod(dateRange),
      enabled,
    ),
  );
}

export function useReportsRevenue(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('revenue'), dateRange],
      () => reportsService.getRevenue(dateRange),
      enabled,
    ),
  );
}

export function useReportsTopProducts(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('topProducts'), dateRange],
      () => reportsService.getTopProducts(dateRange),
      enabled,
    ),
  );
}

export function useReportsSalesByCategory(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('salesByCategory'), dateRange],
      () => reportsService.getSalesByCategory(dateRange),
      enabled,
    ),
  );
}

export function useInventoryReportSummary(enabled = true) {
  return useQuery(
    reportQueryOptions(
      QUERY_KEYS.reports('inventorySummary'),
      () => reportsService.getInventorySummary(),
      enabled,
    ),
  );
}

export function useExpiringProducts(enabled = true, withinDays = 30) {
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('expiring'), withinDays],
      () => reportsService.getExpiringProducts(1, 25, withinDays),
      enabled,
    ),
  );
}

export function useLowStockReport(enabled = true, productStatus: ProductStatus | '' = '') {
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('lowStock'), productStatus],
      () => reportsService.getLowStock(1, 100, 'both', productStatus || undefined),
      enabled,
    ),
  );
}

export function useProfitSummary(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('profit'), dateRange],
      () => reportsService.getProfitSummary(dateRange),
      enabled,
    ),
  );
}

export function useMarginByCategory(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('marginByCategory'), dateRange],
      () => reportsService.getMarginByCategory(dateRange),
      enabled,
    ),
  );
}

export function usePurchasingBySupplier(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('purchasing'), dateRange],
      () => reportsService.getPurchasingBySupplier(dateRange),
      enabled,
    ),
  );
}

export function usePurchaseOrdersSummary(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('poSummary'), dateRange],
      () => reportsService.getPurchaseOrdersSummary(dateRange),
      enabled,
    ),
  );
}

export function useTopCustomers(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('topCustomers'), dateRange],
      () => reportsService.getTopCustomers(dateRange),
      enabled,
    ),
  );
}

export function useLoyaltySummary(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('loyalty'), dateRange],
      () => reportsService.getLoyaltySummary(dateRange),
      enabled,
    ),
  );
}

export function useSalesByHour(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('salesByHour'), dateRange],
      () => reportsService.getSalesByHour(dateRange),
      enabled,
    ),
  );
}

export function useSalesByDayOfWeek(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('salesByDay'), dateRange],
      () => reportsService.getSalesByDayOfWeek(dateRange),
      enabled,
    ),
  );
}

export function useSalesByCashier(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('salesByCashier'), dateRange],
      () => reportsService.getSalesByCashier(dateRange),
      enabled,
    ),
  );
}

export function useDeadStock(enabled = true) {
  return useQuery(
    reportQueryOptions(
      QUERY_KEYS.reports('deadStock'),
      () => reportsService.getDeadStock(30),
      enabled,
    ),
  );
}

export function useExpenseSummary(enabled = true) {
  const dateRange = useReportDateRange();
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('expenseSummary'), dateRange],
      () => reportsService.getExpenseSummary(dateRange),
      enabled,
    ),
  );
}

export function useDailySummary(date: string, enabled = true) {
  return useQuery(
    reportQueryOptions(
      [...QUERY_KEYS.reports('dailySummary'), date],
      () => reportsService.getDailySummary(date),
      enabled && !!date,
    ),
  );
}

export function useUpsertDayClose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      date,
      data,
    }: {
      date: string;
      data: import('@/types').DayCloseUpsertPayload;
    }) => dayCloseService.upsert(date, data),
    onSuccess: (_, { date }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports('dailySummary') });
      void queryClient.invalidateQueries({
        queryKey: [...QUERY_KEYS.reports('dailySummary'), date],
      });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.walletBalances });
    },
  });
}

export function useOpeningSuggestion(date: string, enabled = true) {
  return useQuery({
    queryKey: [...QUERY_KEYS.reports('dailySummary'), date, 'openingSuggestion'],
    queryFn: () => dayCloseService.getOpeningSuggestion(date),
    enabled: enabled && !!date,
    staleTime: STALE_TIME.standard,
  });
}

export function useCloseDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => dayCloseService.close(date),
    onSuccess: (_, date) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports('dailySummary') });
      void queryClient.invalidateQueries({
        queryKey: [...QUERY_KEYS.reports('dailySummary'), date],
      });
    },
  });
}

export function useReopenDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => dayCloseService.reopen(date),
    onSuccess: (_, date) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports('dailySummary') });
      void queryClient.invalidateQueries({
        queryKey: [...QUERY_KEYS.reports('dailySummary'), date],
      });
    },
  });
}

export function usePostDayCloseVariance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ date, wallet }: { date: string; wallet: string }) =>
      dayCloseService.postVariance(date, wallet),
    onSuccess: (_, { date }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports('dailySummary') });
      void queryClient.invalidateQueries({
        queryKey: [...QUERY_KEYS.reports('dailySummary'), date],
      });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.wallets });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.walletBalances });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboard });
    },
  });
}
