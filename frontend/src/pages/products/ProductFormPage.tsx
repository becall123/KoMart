import { useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Button,
  Grid,
  TextField,
  MenuItem,
  Typography,
  Paper,
  Divider,
  CircularProgress,
  Avatar,
  IconButton,
  Tooltip,
  Autocomplete,
  Alert,
  Checkbox,
  FormControlLabel,
  InputAdornment,
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import UploadIcon from '@mui/icons-material/Upload';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { NepaliAwareDatePicker } from '@/components/common/NepaliAwareDatePicker';
import { useProduct, useCreateProduct, useUpdateProduct } from '@/hooks/useProducts';
import { useStoreSettings } from '@/hooks/useSettings';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useCategoryNames } from '@/hooks/useCategories';
import { useUomOptions } from '@/hooks/useUoms';
import { DROPDOWN_PAGE_SIZE, PRODUCT_CATEGORIES, COUNTRIES, PRODUCT_STATUS_OPTIONS, SELL_MODE_OPTIONS } from '@/constants';
import { PRODUCT_FIELD_LABELS } from '@/constants/productFieldLabels';
import { UomConversionHint, UomSectionTitle } from '@/components/uom/UomUi';
import { formatCurrency } from '@/utils';
import { computeProductPricing } from '@/utils/productPricing';
import { defaultPrimaryUom, hasUomConversion, normalizeProductUoms } from '@/utils/uomNormalize';
import { showApiError, showSuccess, showWarning } from '@/utils/toast';
import { productService } from '@/services';

function todayAd(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── SKU generator (server-backed) ─────────────────────────────────────────────
const schema = z.object({
  name:            z.string().min(1, 'Name is required'),
  sku:             z.string(),
  barcode:         z.string(),
  brand:           z.string(),
  countryOfOrigin: z.string(),
  category:        z.string(),
  supplierId:      z.string(),
  buyUom:          z.string().min(1, 'Primary Unit is required'),
  uom:             z.string(),
  unitsPerBuyUom:  z.number().int().min(1, 'Must be at least 1'),
  sellMode:        z.enum(['unit', 'piece', 'both']),
  description:     z.string(),
  imageUrl:        z.string().url('Enter a valid URL').or(z.literal('')),
  costPrice:       z.number().min(0, 'Must be ≥ 0'),
  sellingPrice:    z.number().min(0, 'Must be ≥ 0'),
  packSellingPrice: z.number().min(0, 'Must be ≥ 0'),
  discountPercent: z.number().min(0).max(100),
  offeredPrice: z.number().min(0, 'Must be ≥ 0'),
  packDiscountPercent: z.number().min(0).max(100),
  packOfferedPrice: z.number().min(0, 'Must be ≥ 0'),
  lowStockThreshold: z.number().int().min(0, 'Must be ≥ 0'),
  status:            z.enum(['active', 'discontinued', 'seasonal']),
  tags:              z.array(z.string().min(1)),
  isPopular:         z.boolean(),
  isTrending:        z.boolean(),
  costPriceEffectiveFrom: z.string(),
  sellingPriceEffectiveFrom: z.string(),
  nutritionInfo:   z.string(),
  allergenInfo:    z.string(),
}).superRefine((data, ctx) => {
  if (!data.sku.trim() && !data.category.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Select a category to auto-generate SKU, or enter a SKU',
      path: ['sku'],
    });
  }
  const converting = hasUomConversion(data.unitsPerBuyUom);
  if (converting && !data.uom.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Secondary Unit is required when conversion is used',
      path: ['uom'],
    });
  }
  const packSellEnabled =
    (data.sellMode === 'unit' || data.sellMode === 'both') && converting;
  if (packSellEnabled && data.packSellingPrice <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Pack price is required when selling whole packs/boxes',
      path: ['packSellingPrice'],
    });
  }
  if (data.costPrice > 0 && !data.costPriceEffectiveFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Effective from is required',
      path: ['costPriceEffectiveFrom'],
    });
  }
  if (data.sellingPrice > 0 && !data.sellingPriceEffectiveFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Effective from is required',
      path: ['sellingPriceEffectiveFrom'],
    });
  }
});

function buildPackPriceHelper(
  sellingPrice: number,
  unitsPerBuyUom: number,
  packSellingPrice: number,
): string {
  const suggested = sellingPrice * unitsPerBuyUom;
  if (suggested <= 0) {
    return 'Set piece price first, then enter a pack bundle price';
  }
  const base = `Suggested: ${formatCurrency(suggested)} (${unitsPerBuyUom} × piece price)`;
  if (packSellingPrice <= 0) return base;
  const diff = suggested - packSellingPrice;
  if (Math.abs(diff) < 0.01) return `${base}. Matches suggested linear price.`;
  if (diff > 0) {
    return `${base}. Your pack price saves ${formatCurrency(diff)} vs selling ${unitsPerBuyUom} singles.`;
  }
  return `${base}. Your pack price is ${formatCurrency(Math.abs(diff))} above the linear price.`;
}

type FormValues = z.infer<typeof schema>;

export function ProductFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: product, isLoading: productLoading } = useProduct(id ?? '');
  const { data: storeSettings } = useStoreSettings();
  const { data: suppliersData } = useSuppliers({ pageSize: DROPDOWN_PAGE_SIZE });
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  // DB-backed categories; fall back to hardcoded list while loading
  const dbCategories = useCategoryNames();
  const categoryOptions = dbCategories.length > 0 ? dbCategories : [...PRODUCT_CATEGORIES];
  const uomOptions = useUomOptions();

  const suppliers = suppliersData?.data ?? [];
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      description: '',
      imageUrl: '',
      buyUom: '',
      uom: '',
      barcode: '',
      brand: '',
      countryOfOrigin: '',
      category: '',
      supplierId: '',
      unitsPerBuyUom: 1,
      sellMode: 'unit',
      costPrice: 0,
      sellingPrice: 0,
      packSellingPrice: 0,
      discountPercent: 0,
      offeredPrice: 0,
      packDiscountPercent: 0,
      packOfferedPrice: 0,
      lowStockThreshold: 10,
      status: 'active',
      tags: [],
      isPopular: false,
      isTrending: false,
      costPriceEffectiveFrom: todayAd(),
      sellingPriceEffectiveFrom: todayAd(),
      nutritionInfo: '',
      allergenInfo: '',
    },
  });

  const { ref: barcodeRegRef, ...barcodeField } = register('barcode');

  useEffect(() => {
    if (isEditing) return;
    const primary = defaultPrimaryUom(uomOptions);
    if (!primary) return;
    const current = watch('buyUom');
    if (!current) {
      setValue('buyUom', primary);
      setValue('uom', primary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only seed once options arrive
  }, [isEditing, uomOptions, setValue]);

  useEffect(() => {
    if (product) {
      const factor = product.unitsPerBuyUom ?? 1;
      const buy = product.buyUom ?? product.uom ?? '';
      const secondary = hasUomConversion(factor) ? (product.uom ?? '') : buy;
      reset({
        name:             product.name,
        sku:              product.sku,
        barcode:          product.barcode,
        brand:            product.brand,
        countryOfOrigin:  product.countryOfOrigin,
        category:         product.category,
        supplierId:       product.supplierId,
        buyUom:           buy,
        uom:              secondary,
        unitsPerBuyUom:   factor,
        sellMode:           product.sellMode ?? 'unit',
        description:      product.description,
        imageUrl:         product.images[0] ?? '',
        costPrice:        product.costPrice,
        sellingPrice:     product.sellingPrice,
        packSellingPrice: product.packSellingPrice ?? 0,
        discountPercent: product.discountPercent ?? 0,
        offeredPrice: product.offeredPrice ?? product.sellingPrice,
        packDiscountPercent: product.packDiscountPercent ?? 0,
        packOfferedPrice: product.packOfferedPrice ?? product.packSellingPrice ?? 0,
        lowStockThreshold: product.lowStockThreshold,
        status:            product.status ?? 'active',
        tags:              product.tags ?? [],
        isPopular:         product.isPopular ?? false,
        isTrending:        product.isTrending ?? false,
        costPriceEffectiveFrom: product.costPriceEffectiveFrom || todayAd(),
        sellingPriceEffectiveFrom: product.sellingPriceEffectiveFrom || todayAd(),
        nutritionInfo:    product.nutritionInfo ?? '',
        allergenInfo:     product.allergenInfo ?? '',
      });
    }
  }, [product, reset]);

  useEffect(() => {
    if (!isEditing && storeSettings?.defaultLowStockThreshold != null) {
      setValue('lowStockThreshold', storeSettings.defaultLowStockThreshold);
    }
  }, [isEditing, storeSettings, setValue]);

  const brand = watch('brand');
  const category = watch('category');
  const buyUom = watch('buyUom');
  const sellUom = watch('uom');
  const unitsPerBuyUom = watch('unitsPerBuyUom');
  const sellMode = watch('sellMode');
  const sellingPrice = watch('sellingPrice');
  const costPrice = watch('costPrice');
  const packSellingPrice = watch('packSellingPrice');
  const discountPercent = watch('discountPercent');
  const offeredPrice = watch('offeredPrice');
  const packDiscountPercent = watch('packDiscountPercent');
  const packOfferedPrice = watch('packOfferedPrice');
  const packSellEnabled =
    (sellMode === 'unit' || sellMode === 'both') && hasUomConversion(unitsPerBuyUom);
  const usesConversion = hasUomConversion(unitsPerBuyUom);
  const suggestedPackPrice = sellingPrice * unitsPerBuyUom;

  useEffect(() => {
    if (!usesConversion && buyUom) {
      setValue('uom', buyUom);
      setValue('unitsPerBuyUom', 1);
    }
  }, [buyUom, usesConversion, setValue]);

  const derivedPricing = computeProductPricing({
    costPrice: costPrice ?? 0,
    sellingPrice: sellingPrice ?? 0,
    packSellingPrice: packSellingPrice ?? 0,
    unitsPerBuyUom: unitsPerBuyUom ?? 1,
    discountPercent: discountPercent ?? 0,
    offeredPrice: offeredPrice ?? 0,
    packDiscountPercent: packDiscountPercent ?? 0,
    packOfferedPrice: packOfferedPrice ?? 0,
  });

  // ── Auto SKU ──────────────────────────────────────────────────────────────
  const handleGenerateSku = useCallback(() => {
    const brandVal = watch('brand');
    const categoryVal = watch('category');
    const currentSku = watch('sku');
    if (!categoryVal?.trim()) {
      showWarning('Select a category to generate SKU.');
      return;
    }
    void productService
      .suggestSkus([{ brand: brandVal || '', category: categoryVal }], currentSku ? [currentSku] : [])
      .then(({ skus }) => {
        if (skus[0]) setValue('sku', skus[0], { shouldValidate: true });
      })
      .catch((err) => {
        showApiError(err, 'Could not generate SKU.');
      });
  }, [watch, setValue]);

  // ── Image file picker ────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setValue('imageUrl', reader.result as string, { shouldValidate: true });
    };
    reader.readAsDataURL(file);
    // reset the input so the same file can be re-selected
    e.target.value = '';
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const onSubmit = async (values: FormValues) => {
    try {
      const { imageUrl, ...rest } = values;
      const uoms = normalizeProductUoms({
        buyUom: rest.buyUom,
        uom: rest.uom,
        unitsPerBuyUom: rest.unitsPerBuyUom,
      });
      const images = imageUrl ? [imageUrl] : [];
      const supplier = suppliers.find((s) => s.id === values.supplierId);
      const payload = {
        ...rest,
        ...uoms,
        sellMode: hasUomConversion(uoms.unitsPerBuyUom) ? rest.sellMode : 'unit',
        images,
        stock: product?.stock ?? 0,
        supplierName: supplier?.name ?? product?.supplierName ?? '',
      };
      if (isEditing && id) {
        await updateMutation.mutateAsync({ id, data: payload });
        showSuccess('Product updated.');
        navigate(`/products/${id}`);
      } else {
        const created = await createMutation.mutateAsync(payload);
        showSuccess('Product created.');
        navigate(`/products/${created.id}`);
      }
    } catch (err) {
      showApiError(err, isEditing ? 'Product could not be saved.' : 'Product could not be created.');
    }
  };

  const imageUrl = watch('imageUrl');

  if (isEditing && productLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const pending = isSubmitting || createMutation.isPending || updateMutation.isPending;

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <PageHeader
        title={isEditing ? 'Edit Product' : 'Add Product'}
        breadcrumbs={[{ label: 'Products', path: '/products' }, { label: isEditing ? 'Edit' : 'New' }]}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/products')}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              startIcon={<SaveIcon />}
              loading={pending}
            >
              {isEditing ? 'Update' : 'Create'} Product
            </Button>
          </Box>
        }
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        Change <strong>sell price</strong> here. Change <strong>quantity</strong> from Inventory (Receive / Adjust) — stock is batch-based and cannot be edited on this form.
        {isEditing && product && (
          <>
            {' '}Current stock: <strong>{product.stock}</strong>.
            <Button size="small" sx={{ ml: 1 }} onClick={() => navigate(`/inventory/${product.id}`)}>
              Manage in Inventory
            </Button>
          </>
        )}
      </Alert>

      <Grid container spacing={3}>
        {/* ── Left column ─────────────────────────────────────────────────── */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Basic Information</Typography>
            <Divider sx={{ mb: 3 }} />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  {...register('name')}
                  label="Product Name"
                  fullWidth
                  error={!!errors.name}
                  helperText={errors.name?.message}
                />
              </Grid>

              {/* SKU with auto-generate */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register('sku')}
                  label="SKU"
                  fullWidth
                  error={!!errors.sku}
                  helperText={
                    errors.sku?.message
                    || 'Format: 6 digits (category code + product number), assigned by server. Select a category first.'
                  }
                  slotProps={{
                    input: {
                      endAdornment: (
                        <Tooltip title={category ? 'Generate SKU from category' : 'Select a category to generate SKU'}>
                          <span>
                            <IconButton
                              size="small"
                              onClick={handleGenerateSku}
                              tabIndex={-1}
                              disabled={!category}
                            >
                              <AutorenewIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ),
                    },
                  }}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...barcodeField}
                  inputRef={(el: HTMLInputElement | null) => {
                    barcodeRegRef(el);
                    barcodeInputRef.current = el;
                  }}
                  label="Barcode (optional)"
                  fullWidth
                  error={!!errors.barcode}
                  helperText={errors.barcode?.message || 'Click here, then scan — scanner types into this field.'}
                  onFocus={(e) => e.target.select()}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title="Focus for barcode scanner">
                            <IconButton
                              size="small"
                              aria-label="Focus for barcode scanner"
                              tabIndex={-1}
                              onClick={() => {
                                barcodeInputRef.current?.focus();
                                barcodeInputRef.current?.select();
                              }}
                            >
                              <QrCodeScannerIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register('brand')}
                  label="Brand (optional)"
                  fullWidth
                  error={!!errors.brand}
                  helperText={errors.brand?.message}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="countryOfOrigin"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Country of Origin (optional)"
                      fullWidth
                      error={!!errors.countryOfOrigin}
                      helperText={errors.countryOfOrigin?.message}
                    >
                      <MenuItem value="">None</MenuItem>
                      {COUNTRIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </TextField>
                  )}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 8 }}>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Category (optional)"
                      fullWidth
                      error={!!errors.category}
                      helperText={errors.category?.message}
                    >
                      <MenuItem value="">None</MenuItem>
                      {categoryOptions.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </TextField>
                  )}
                />
              </Grid>

              <Grid size={{ xs: 12 }}>
                <Controller
                  name="tags"
                  control={control}
                  render={({ field }) => (
                    <Autocomplete
                      multiple
                      freeSolo
                      options={[]}
                      value={field.value}
                      onChange={(_, value) => {
                        const normalized = value
                          .map((tag) => tag.trim())
                          .filter(Boolean);
                        field.onChange([...new Set(normalized)]);
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Tags"
                          placeholder="Type and press Enter"
                          helperText="Labels like organic, imported, bestseller"
                        />
                      )}
                    />
                  )}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 4 }}>
                <Controller
                  name="supplierId"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Primary Supplier (optional)"
                      fullWidth
                      error={!!errors.supplierId}
                      helperText={errors.supplierId?.message}
                    >
                      <MenuItem value="">None</MenuItem>
                      {suppliers.map((s) => (
                        <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>

              <Grid size={{ xs: 12 }}>
                <Divider sx={{ my: 1 }} />
                <UomSectionTitle>Primary Unit (purchase)</UomSectionTitle>
              </Grid>

              <Grid size={{ xs: 12, sm: 4 }}>
                <Controller
                  name="buyUom"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Primary Unit"
                      fullWidth
                      error={!!errors.buyUom}
                      helperText={errors.buyUom?.message ?? 'How the supplier bills (pack, box)'}
                    >
                      {!buyUom && <MenuItem value="">Select…</MenuItem>}
                      {uomOptions.map((u) => (
                        <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 8 }} sx={{ display: 'flex', alignItems: 'center' }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={usesConversion}
                      onChange={(_, checked) => {
                        if (checked) {
                          setValue('unitsPerBuyUom', Math.max(2, unitsPerBuyUom || 2), { shouldValidate: true });
                          if (!sellUom || sellUom === buyUom) {
                            setValue('uom', '', { shouldValidate: true });
                          }
                        } else {
                          setValue('unitsPerBuyUom', 1, { shouldValidate: true });
                          setValue('uom', buyUom || '', { shouldValidate: true });
                          setValue('sellMode', 'unit');
                          setValue('packSellingPrice', 0);
                        }
                      }}
                    />
                  }
                  label="Uses conversion (Secondary Unit)"
                />
              </Grid>

              {usesConversion && (
                <>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      {...register('unitsPerBuyUom', { valueAsNumber: true })}
                      label="Conversion Rate"
                      type="number"
                      fullWidth
                      error={!!errors.unitsPerBuyUom}
                      helperText={
                        errors.unitsPerBuyUom?.message
                        ?? 'Secondary units inside one Primary Unit (e.g. 24 pcs per box)'
                      }
                      slotProps={{ htmlInput: { min: 2, step: 1 } }}
                    />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 4 }} sx={{ display: 'flex', alignItems: 'center' }}>
                    <UomConversionHint
                      buyUom={buyUom}
                      baseUom={sellUom}
                      factor={unitsPerBuyUom}
                      uomOptions={uomOptions}
                    />
                  </Grid>

                  <Grid size={{ xs: 12 }}>
                    <Divider sx={{ my: 1 }} />
                    <UomSectionTitle>Secondary Unit (stock &amp; sell)</UomSectionTitle>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Controller
                      name="uom"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          select
                          label="Secondary Unit"
                          fullWidth
                          error={!!errors.uom}
                          helperText={errors.uom?.message ?? 'Stock is counted in this unit'}
                        >
                          {uomOptions.map((u) => (
                            <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
                          ))}
                        </TextField>
                      )}
                    />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Controller
                      name="sellMode"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          select
                          label="Sell mode"
                          fullWidth
                          error={!!errors.sellMode}
                          helperText={errors.sellMode?.message ?? 'How cashiers sell at POS'}
                        >
                          {SELL_MODE_OPTIONS.map((o) => (
                            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                          ))}
                        </TextField>
                      )}
                    />
                  </Grid>
                </>
              )}

              <Grid size={{ xs: 12 }}>
                <TextField
                  {...register('description')}
                  label="Description"
                  fullWidth
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Additional Info</Typography>
            <Divider sx={{ mb: 3 }} />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  {...register('nutritionInfo')}
                  label="Nutrition Information"
                  fullWidth
                  multiline
                  rows={3}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  {...register('allergenInfo')}
                  label="Allergen Information"
                  fullWidth
                  multiline
                  rows={2}
                />
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <Grid size={{ xs: 12, lg: 4 }}>
          {/* Image */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Product Image</Typography>
            <Divider sx={{ mb: 3 }} />

            {/* Preview */}
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Avatar
                src={imageUrl || undefined}
                variant="rounded"
                sx={{ width: 140, height: 140, bgcolor: 'grey.100' }}
              >
                <ImageIcon sx={{ fontSize: 56, color: 'grey.400' }} />
              </Avatar>
            </Box>

            {/* Upload button */}
            <Button
              variant="outlined"
              fullWidth
              startIcon={<UploadIcon />}
              onClick={() => fileInputRef.current?.click()}
              sx={{ mb: 1.5 }}
            >
              Upload Image
            </Button>

            {/* URL fallback */}
            <TextField
              {...register('imageUrl')}
              label="or paste Image URL"
              fullWidth
              size="small"
              placeholder="https://…"
              error={!!errors.imageUrl}
              helperText={errors.imageUrl?.message}
            />

            {/* Clear button */}
            {imageUrl && (
              <Button
                size="small"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => setValue('imageUrl', '')}
                sx={{ mt: 1 }}
              >
                Remove Image
              </Button>
            )}
          </Paper>

          {/* Pricing */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Pricing</Typography>
            <Divider sx={{ mb: 3 }} />
            <Grid container spacing={2}>
              <Grid size={12}>
                <TextField
                  {...register('costPrice', { valueAsNumber: true })}
                  label={PRODUCT_FIELD_LABELS.unitCost}
                  type="number"
                  fullWidth
                  error={!!errors.costPrice}
                  helperText={errors.costPrice?.message ?? 'Per secondary unit'}
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
              </Grid>
              <Grid size={12}>
                <Controller
                  name="costPriceEffectiveFrom"
                  control={control}
                  render={({ field }) => (
                    <NepaliAwareDatePicker
                      label="Cost effective from"
                      value={field.value}
                      onChange={field.onChange}
                      fullWidth
                      helperText={errors.costPriceEffectiveFrom?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  {...register('sellingPrice', { valueAsNumber: true })}
                  label={PRODUCT_FIELD_LABELS.unitPrice}
                  type="number"
                  fullWidth
                  error={!!errors.sellingPrice}
                  helperText={errors.sellingPrice?.message ?? 'Per secondary unit · NPR 0 hides product from POS'}
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
              </Grid>
              <Grid size={12}>
                <Controller
                  name="sellingPriceEffectiveFrom"
                  control={control}
                  render={({ field }) => (
                    <NepaliAwareDatePicker
                      label="Selling effective from"
                      value={field.value}
                      onChange={field.onChange}
                      fullWidth
                      helperText={errors.sellingPriceEffectiveFrom?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={12}>
                <Controller
                  name="isPopular"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                      label="Most Popular"
                    />
                  )}
                />
                <Controller
                  name="isTrending"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                      label="Trending"
                    />
                  )}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label={PRODUCT_FIELD_LABELS.marginPercent}
                  value={derivedPricing.marginPercent.toFixed(1)}
                  fullWidth
                  disabled
                  helperText="Saved when product is updated"
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label={PRODUCT_FIELD_LABELS.packSavings}
                  value={formatCurrency(derivedPricing.discountedAmount)}
                  fullWidth
                  disabled
                  helperText="Savings vs buying singles as a pack"
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  {...register('discountPercent', { valueAsNumber: true })}
                  label={PRODUCT_FIELD_LABELS.discountPercent}
                  type="number"
                  fullWidth
                  error={!!errors.discountPercent}
                  slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  {...register('offeredPrice', { valueAsNumber: true })}
                  label={PRODUCT_FIELD_LABELS.offeredPrice}
                  type="number"
                  fullWidth
                  error={!!errors.offeredPrice}
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
              </Grid>
              {packSellEnabled && (
                <Grid size={12}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField
                      {...register('packSellingPrice', { valueAsNumber: true })}
                      label={PRODUCT_FIELD_LABELS.packPrice}
                      type="number"
                      fullWidth
                      error={!!errors.packSellingPrice}
                      helperText={
                        errors.packSellingPrice?.message
                        ?? buildPackPriceHelper(sellingPrice, unitsPerBuyUom, packSellingPrice)
                      }
                      slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                    />
                    {suggestedPackPrice > 0 && (
                      <Button
                        type="button"
                        variant="outlined"
                        size="small"
                        sx={{ mt: 1, flexShrink: 0, whiteSpace: 'nowrap' }}
                        onClick={() => setValue(
                          'packSellingPrice',
                          Math.round(suggestedPackPrice * 100) / 100,
                          { shouldValidate: true },
                        )}
                      >
                        Use suggested
                      </Button>
                    )}
                  </Box>
                </Grid>
              )}
              {packSellEnabled && (
                <>
                  <Grid size={6}>
                    <TextField
                      {...register('packDiscountPercent', { valueAsNumber: true })}
                      label={PRODUCT_FIELD_LABELS.packDiscountPercent}
                      type="number"
                      fullWidth
                      error={!!errors.packDiscountPercent}
                      slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }}
                    />
                  </Grid>
                  <Grid size={6}>
                    <TextField
                      {...register('packOfferedPrice', { valueAsNumber: true })}
                      label={PRODUCT_FIELD_LABELS.packOfferedPrice}
                      type="number"
                      fullWidth
                      error={!!errors.packOfferedPrice}
                      slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                    />
                  </Grid>
                </>
              )}
            </Grid>
          </Paper>

          {/* Stock settings (threshold only — actual stock is managed via Inventory) */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>Stock Settings</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Stock is managed from the Inventory page.
            </Typography>
            <Divider sx={{ mb: 3 }} />
            <TextField
              {...register('lowStockThreshold', { valueAsNumber: true })}
              label={PRODUCT_FIELD_LABELS.lowStock}
              type="number"
              fullWidth
              error={!!errors.lowStockThreshold}
              helperText={errors.lowStockThreshold?.message ?? 'Alert triggers when stock falls below this'}
              slotProps={{ htmlInput: { min: 0 } }}
              sx={{ mb: 2 }}
            />
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="Product Status"
                  fullWidth
                  helperText="Discontinued items are hidden from POS"
                >
                  {PRODUCT_STATUS_OPTIONS.map((s) => (
                    <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                  ))}
                </TextField>
              )}
            />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
