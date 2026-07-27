import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import BlockIcon from '@mui/icons-material/Block';
import { SettingsSectionHeader } from '@/components/common/SettingsSectionHeader';
import { useDiscountRules, useCreateDiscountRule, useUpdateDiscountRule, useDeleteDiscountRule } from '@/hooks/useDiscounts';
import { useProducts } from '@/hooks/useProducts';
import { useCategoryNames } from '@/hooks/useCategories';
import { DISCOUNT_RULE_TYPES, DROPDOWN_PAGE_SIZE, PRODUCT_SEARCH_PAGE_SIZE } from '@/constants';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { DiscountRule, DiscountRuleType, Product } from '@/types';

const EMPTY_FORM = {
  name: '',
  code: '',
  ruleType: 'category_percent' as DiscountRuleType,
  value: 10,
  productIds: [] as string[],
  category: '',
  minCartTotal: 0,
  minLineQty: 0,
  sellUom: '',
  maxDiscount: 0,
  priority: 0,
};

function ruleTypeLabel(type: DiscountRuleType): string {
  return DISCOUNT_RULE_TYPES.find((t) => t.value === type)?.label ?? type;
}

function ruleScopeLabel(rule: DiscountRule, productMap: Map<string, string>): string {
  if (rule.ruleType.startsWith('product_')) {
    const count = rule.productIds.length;
    if (count === 0) return '—';
    if (count === 1) return productMap.get(rule.productIds[0]) ?? '1 product';
    return `${count} products`;
  }
  if (rule.ruleType.startsWith('category_')) return rule.category || '—';
  return 'Entire cart';
}

function ruleValueLabel(rule: DiscountRule): string {
  return rule.ruleType.includes('percent') ? `${rule.value}%` : `Rs. ${rule.value}`;
}

function productNamesTooltip(productIds: string[], productMap: Map<string, string>): React.ReactNode {
  if (productIds.length === 0) return '';
  return (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {productIds.map((id) => (
        <span key={id}>{productMap.get(id) ?? id}</span>
      ))}
    </Box>
  );
}

export function DiscountsTab() {
  const { data: rules = [], isLoading } = useDiscountRules(false);
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebouncedValue(productSearch, 300);
  const categories = useCategoryNames();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DiscountRule | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [productLabelCache, setProductLabelCache] = useState<Map<string, string>>(() => new Map());

  const needsProduct = form.ruleType.startsWith('product_');
  const needsCategory = form.ruleType.startsWith('category_');
  const isPercent = form.ruleType.includes('percent');

  const hasRuleProducts = rules.some((r) => r.productIds.length > 0);
  const { data: labelProductsData } = useProducts(
    { pageSize: DROPDOWN_PAGE_SIZE },
    { enabled: hasRuleProducts },
  );
  const { data: searchProductsData } = useProducts(
    { search: debouncedProductSearch || undefined, pageSize: PRODUCT_SEARCH_PAGE_SIZE },
    { enabled: dialogOpen && needsProduct },
  );

  const products = searchProductsData?.data ?? [];
  const labelProducts = labelProductsData?.data ?? [];

  const productMap = useMemo(() => {
    const map = new Map<string, string>(productLabelCache);
    for (const p of labelProducts) map.set(p.id, p.name);
    for (const p of products) map.set(p.id, p.name);
    return map;
  }, [labelProducts, products, productLabelCache]);

  useEffect(() => {
    if (!dialogOpen || (!labelProducts.length && !products.length)) return;
    setProductLabelCache((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const p of [...labelProducts, ...products]) {
        if (next.get(p.id) !== p.name) {
          next.set(p.id, p.name);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [dialogOpen, labelProducts, products]);

  const createMutation = useCreateDiscountRule();
  const updateMutation = useUpdateDiscountRule();
  const deleteMutation = useDeleteDiscountRule();

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name)),
    [rules],
  );

  const selectedProducts = useMemo(
    () => form.productIds.map((id) => {
      const fromSearch = products.find((p) => p.id === id);
      if (fromSearch) return fromSearch;
      const name = productMap.get(id) ?? id;
      return { id, name } as Product;
    }),
    [products, form.productIds, productMap],
  );

  const productOptions = useMemo(() => {
    const byId = new Map<string, Product>();
    for (const p of products) byId.set(p.id, p);
    for (const p of selectedProducts) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    return [...byId.values()];
  }, [products, selectedProducts]);

  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setProductSearch('');
    setProductLabelCache(new Map());
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (rule: DiscountRule) => {
    setEditTarget(rule);
    setProductSearch('');
    const cache = new Map<string, string>();
    for (const id of rule.productIds) {
      const name = productMap.get(id);
      if (name) cache.set(id, name);
    }
    setProductLabelCache(cache);
    setForm({
      name: rule.name,
      code: rule.code,
      ruleType: rule.ruleType,
      value: rule.value,
      productIds: rule.productIds,
      category: rule.category,
      minCartTotal: rule.minCartTotal,
      minLineQty: rule.minLineQty ?? 0,
      sellUom: rule.sellUom ?? '',
      maxDiscount: rule.maxDiscount,
      priority: rule.priority,
    });
    setError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    try {
      if (editTarget) {
        await updateMutation.mutateAsync({ id: editTarget.id, ...form });
        showSuccess('Discount rule updated.');
      } else {
        await createMutation.mutateAsync(form);
        showSuccess('Discount rule created.');
      }
      setDialogOpen(false);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDeactivate = async (rule: DiscountRule) => {
    try {
      await deleteMutation.mutateAsync(rule.id);
      showSuccess('Discount rule deactivated.');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <SettingsSectionHeader
        title="Discount Rules"
        description="Auto-apply promotions at POS. Leave coupon code empty for automatic rules."
        action={(
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Add Rule
          </Button>
        )}
      />

      {error && !dialogOpen && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Scope</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Coupon</TableCell>
              <TableCell align="right">Min Cart</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No discount rules yet
                </TableCell>
              </TableRow>
            ) : (
              sortedRules.map((rule) => (
                <TableRow key={rule.id} sx={{ opacity: rule.isActive ? 1 : 0.55 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{rule.name}</Typography>
                    {rule.priority > 0 && (
                      <Typography variant="caption" color="text.secondary">Priority {rule.priority}</Typography>
                    )}
                  </TableCell>
                  <TableCell>{ruleTypeLabel(rule.ruleType)}</TableCell>
                  <TableCell>
                    <Tooltip
                      title={
                        rule.ruleType.startsWith('product_') && rule.productIds.length > 0
                          ? productNamesTooltip(rule.productIds, productMap)
                          : ''
                      }
                    >
                      <span>{ruleScopeLabel(rule, productMap)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>{ruleValueLabel(rule)}</TableCell>
                  <TableCell>{rule.code || 'Auto'}</TableCell>
                  <TableCell align="right">
                    {rule.minCartTotal > 0 ? `Rs. ${rule.minCartTotal}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={rule.isActive ? 'Active' : 'Inactive'}
                      size="small"
                      color={rule.isActive ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(rule)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {rule.isActive && (
                      <Tooltip title="Deactivate">
                        <IconButton size="small" color="error" onClick={() => void handleDeactivate(rule)}>
                          <BlockIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editTarget ? 'Edit Discount Rule' : 'New Discount Rule'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            fullWidth
            required
          />
          <FormControl fullWidth>
            <InputLabel>Rule Type</InputLabel>
            <Select
              label="Rule Type"
              value={form.ruleType}
              onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value as DiscountRuleType }))}
            >
              {DISCOUNT_RULE_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {needsProduct && (
            <Autocomplete<Product, true, false, false>
              multiple
              options={productOptions}
              inputValue={productSearch}
              onInputChange={(_e, value, reason) => {
                if (reason === 'input') setProductSearch(value);
                else if (reason === 'clear') setProductSearch('');
              }}
              getOptionLabel={(option: Product) => option.name}
              value={selectedProducts}
              onChange={(_e, newValue) => {
                setProductLabelCache((prev) => {
                  const next = new Map(prev);
                  for (const p of newValue) next.set(p.id, p.name);
                  return next;
                });
                setForm((f) => ({ ...f, productIds: newValue.map((p) => p.id) }));
              }}
              isOptionEqualToValue={(option: Product, value: Product) => option.id === value.id}
              renderInput={(params) => <TextField {...params} label="Products" placeholder="Search products…" />}
              renderValue={(value, getItemProps) =>
                (value as Product[]).map((option, index) => {
                  const { key, ...itemProps } = getItemProps({ index });
                  return (
                    <Tooltip key={key} title={option.name}>
                      <Chip label={option.name} size="small" {...itemProps} />
                    </Tooltip>
                  );
                })
              }
            />
          )}
          {needsCategory && (
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                label="Category"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {categories.map((c) => (
                  <MenuItem key={c} value={c}>{c}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <TextField
            label={isPercent ? 'Discount (%)' : 'Discount (NPR)'}
            type="number"
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))}
            fullWidth
            slotProps={{ htmlInput: { min: 0, max: isPercent ? 100 : undefined, step: isPercent ? 1 : 10 } }}
          />
          <TextField
            label="Coupon Code (optional)"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            fullWidth
            helperText="Leave blank to auto-apply when conditions match"
          />
          <TextField
            label="Minimum Cart Total (NPR)"
            type="number"
            value={form.minCartTotal}
            onChange={(e) => setForm((f) => ({ ...f, minCartTotal: Number(e.target.value) || 0 }))}
            fullWidth
          />
          <TextField
            label="Minimum Line Qty (optional)"
            type="number"
            value={form.minLineQty || ''}
            onChange={(e) => setForm((f) => ({ ...f, minLineQty: Number(e.target.value) || 0 }))}
            fullWidth
            helperText="Promo only — qty in line sell UOM (e.g. 3 packs)"
          />
          <TextField
            label="Sell UOM filter (optional)"
            value={form.sellUom}
            onChange={(e) => setForm((f) => ({ ...f, sellUom: e.target.value }))}
            fullWidth
            placeholder="e.g. pack, pcs"
            helperText="Leave blank to apply to any sell unit"
          />
          <TextField
            label="Max Discount Cap (NPR, 0 = none)"
            type="number"
            value={form.maxDiscount}
            onChange={(e) => setForm((f) => ({ ...f, maxDiscount: Number(e.target.value) || 0 }))}
            fullWidth
          />
          <TextField
            label="Priority"
            type="number"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))}
            fullWidth
            helperText="Higher priority rules are evaluated first"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            loading={createMutation.isPending || updateMutation.isPending}
          >
            {editTarget ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
