import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS, STALE_TIME } from '@/constants';
import { expenseCategoryService } from '@/services';
import type { ExpenseCategoryItem } from '@/types';

export function useExpenseCategories(includeInactive = false) {
  return useQuery({
    queryKey: [...QUERY_KEYS.expenseCategories, includeInactive],
    queryFn: () => expenseCategoryService.getAll(includeInactive),
    staleTime: STALE_TIME.static,
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { code: string; label: string; description?: string }) =>
      expenseCategoryService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.expenseCategories });
    },
  });
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      code?: string;
      label?: string;
      description?: string;
      isActive?: boolean;
    }) => expenseCategoryService.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.expenseCategories });
    },
  });
}

export function useDeleteExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => expenseCategoryService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.expenseCategories });
    },
  });
}

export type ExpenseCategoryOption = { value: string; label: string };

/** Active expense category options for dropdowns. */
export function useExpenseCategoryOptions(includeInactive = false): ExpenseCategoryOption[] {
  const { data } = useExpenseCategories(includeInactive);
  return useMemo(
    () =>
      (data ?? [])
        .filter((c: ExpenseCategoryItem) => c.isActive)
        .map((c) => ({ value: c.code, label: c.label })),
    [data],
  );
}

export function useExpenseCategoryLabelMap(): Map<string, string> {
  const { data } = useExpenseCategories(true);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data ?? []) {
      map.set(c.code, c.label);
    }
    return map;
  }, [data]);
}
