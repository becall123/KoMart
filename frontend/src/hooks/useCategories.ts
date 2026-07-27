import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS, STALE_TIME } from '@/constants';
import { categoryService } from '@/services';
import type { Category } from '@/types';

export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: [...QUERY_KEYS.categories, includeInactive],
    queryFn: () => categoryService.getAll(includeInactive),
    staleTime: STALE_TIME.static,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; description?: string; code: string }) =>
      categoryService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.categories });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; description?: string; isActive?: boolean }) =>
      categoryService.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.categories });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => categoryService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.categories });
    },
  });
}

export function useCategoryNames(includeInactive = false): string[] {
  const { data } = useCategories(includeInactive);
  return (data ?? []).filter((c: Category) => c.isActive).map((c: Category) => c.name);
}
