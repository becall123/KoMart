import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Autocomplete, TextField, Typography } from '@mui/material';
import { PRODUCT_SEARCH_PAGE_SIZE } from '@/constants';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useProducts } from '@/hooks/useProducts';
import type { Product } from '@/types';
import {
  canSellAsPack,
  canSellAsPiece,
  isPosSellableProduct,
  resolveSellOption,
} from '@/utils/uomSell';
import { showApiError, showWarning } from '@/utils/toast';
import { resolvePosProductByScan } from '@/components/pos/posProductLookup';

export interface PosAddProductAutocompleteProps {
  onAdd: (product: Product, asPack?: boolean) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  size?: 'small' | 'medium';
}

export function PosAddProductAutocomplete({
  onAdd,
  disabled = false,
  label = 'Add product',
  placeholder = 'Search or scan barcode…',
  size = 'small',
}: PosAddProductAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState<Product | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<Product | null>(null);
  const debouncedSearch = useDebouncedValue(inputValue, 300);

  const { data, isFetching } = useProducts({
    search: debouncedSearch.trim() || undefined,
    sellableOnly: true,
    pageSize: PRODUCT_SEARCH_PAGE_SIZE,
    includeImages: false,
  });

  const options = useMemo(
    () => (data?.data ?? []).filter(isPosSellableProduct),
    [data?.data],
  );

  const clearAndFocus = useCallback(() => {
    setValue(null);
    setInputValue('');
    setHighlighted(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const addWithGuards = useCallback(
    (product: Product) => {
      if (!isPosSellableProduct(product)) {
        showWarning(`“${product.name}” cannot be sold.`);
        return;
      }
      const packOnly = canSellAsPack(product) && !canSellAsPiece(product);
      const opt = resolveSellOption(product, packOnly);
      if (product.stock === 0) {
        showWarning(`“${product.name}” is out of stock.`);
        return;
      }
      if (opt.price <= 0) {
        showWarning(`“${product.name}” has no selling price.`);
        return;
      }
      onAdd(product, packOnly);
      clearAndFocus();
    },
    [onAdd, clearAndFocus],
  );

  const tryAddFromScan = useCallback(async () => {
    const code = inputValue.trim();
    if (!code || scanBusy || disabled) return;

    setScanBusy(true);
    try {
      const product = await resolvePosProductByScan(code, options);
      if (!product) {
        showWarning(`No product for barcode “${code}”.`);
        return;
      }
      addWithGuards(product);
    } catch (err) {
      showApiError(err, 'Could not look up barcode.');
    } finally {
      setScanBusy(false);
    }
  }, [inputValue, scanBusy, disabled, options, addWithGuards]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    // Let Autocomplete select the highlighted option.
    if (open && highlighted) return;
    // Popup open with options but no highlight — do not barcode-scan over a name search.
    if (open && options.length > 0) return;
    e.preventDefault();
    void tryAddFromScan();
  };

  return (
    <Autocomplete
      size={size}
      disabled={disabled || scanBusy}
      options={options}
      value={value}
      inputValue={inputValue}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => {
        setOpen(false);
        setHighlighted(null);
      }}
      onHighlightChange={(_, option) => setHighlighted(option)}
      filterOptions={(x) => x}
      onInputChange={(_, next, reason) => {
        if (reason === 'reset') return;
        setInputValue(next);
      }}
      onChange={(_, product) => {
        if (!product) return;
        addWithGuards(product);
      }}
      getOptionLabel={(p) => `${p.name} (${p.sku})`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      clearOnBlur
      blurOnSelect
      loading={isFetching || scanBusy}
      renderOption={(props, p) => (
        <li {...props} key={p.id}>
          <Typography variant="body2" component="span">
            {p.name} ({p.sku})
            {p.barcode ? (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {p.barcode}
              </Typography>
            ) : null}
          </Typography>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
        />
      )}
    />
  );
}
