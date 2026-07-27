import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import GridViewIcon from '@mui/icons-material/GridView';
import TableRowsIcon from '@mui/icons-material/TableRows';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchBar } from '@/components/common/SearchBar';
import { ProductMetaChips } from '@/components/products/ProductMetaChips';
import { DROPDOWN_PAGE_SIZE, GRID_PAGE_SIZE, PRODUCT_CATEGORIES, PRODUCT_STATUS_OPTIONS } from '@/constants';
import { useProducts, useInfiniteProducts } from '@/hooks/useProducts';
import { productService } from '@/services';
import { useDiscountRules } from '@/hooks/useDiscounts';
import { useSuppliers } from '@/hooks/useSuppliers';
import { PriceWithUom } from '@/components/products/PriceWithUom';
import { isAdminOrManager, canManagePurchaseOrders, productStatusColor, productStatusLabel, productStatusOf } from '@/utils';
import { buildProductDiscountMap } from '@/utils/discountDisplay';
import { useCategoryNames } from '@/hooks/useCategories';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAuthStore } from '@/store';
import type { Product, ProductStatus } from '@/types';
import { ProductSheetView } from '@/pages/products/components/ProductSheetView';
import { filterByStock, type StockFilter } from '@/pages/products/productStockFilter';
import { exportProductsToExcel } from '@/pages/products/exportProductsExcel';
import { showApiError, showSuccess, showWarning } from '@/utils/toast';

const SHEET_PAGE_SIZE = 25;

type ViewMode = 'grid' | 'sheet';
type ProductSortField = '' | 'name' | 'sku' | 'sellingPrice' | 'createdAt';

// ── Grid card ──────────────────────────────────────────────────────────────────
interface ProductGridCardProps {
  product: Product;
  discountLabel?: string | null;
  onClick: () => void;
}

const ProductGridCard = memo(function ProductGridCard({ product, discountLabel, onClick }: ProductGridCardProps) {
  const stockColor =
    product.stock === 0 ? 'error' : product.stock <= product.lowStockThreshold ? 'warning' : 'success';
  const stockLabel =
    product.stock === 0
      ? 'Out'
      : product.stock <= product.lowStockThreshold
        ? `Low: ${product.stock}`
        : String(product.stock);

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardActionArea onClick={onClick} sx={{ flexGrow: 1 }}>
        {product.images[0] ? (
          <CardMedia
            component="img"
            image={product.images[0]}
            alt={product.name}
            loading="lazy"
            sx={{ height: 160, objectFit: 'cover' }}
          />
        ) : (
          <Box
            sx={{
              height: 160,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'action.hover',
              fontSize: '2.5rem',
              fontWeight: 700,
              color: 'text.disabled',
            }}
          >
            {(product.name[0] ?? '?').toUpperCase()}
          </Box>
        )}
        <CardContent sx={{ pb: 1 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 700,
              lineHeight: 1.35,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              mb: 0.75,
            }}
            title={product.name}
          >
            {product.name}
          </Typography>
          <Box sx={{ mb: 0.75 }}>
            <ProductMetaChips
              category={product.category}
              tags={product.tags}
              discountLabel={discountLabel}
            />
          </Box>
          {productStatusOf(product.status) !== 'active' && (
            <Chip
              label={productStatusLabel(product.status)}
              size="small"
              color={productStatusColor(product.status)}
              sx={{ mb: 0.75, ml: product.category ? 0.5 : 0, height: 20, fontSize: '0.65rem' }}
            />
          )}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5, mt: 0.5, minWidth: 0 }}>
            <Box sx={{ minWidth: 0, overflow: 'hidden', flex: '1 1 auto' }}>
              <PriceWithUom
                price={product.sellingPrice}
                uom={product.uom ?? ''}
                priceSx={{ fontSize: '0.8125rem' }}
              />
            </Box>
            <Chip
              label={stockLabel}
              color={stockColor}
              size="small"
              sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }}
            />
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
});

// ── Page ───────────────────────────────────────────────────────────────────────
export function ProductsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canManage = isAdminOrManager(user?.role);
  const canCreatePo = canManagePurchaseOrders(user?.role);
  const dbCategories = useCategoryNames();
  const categoryOptions = dbCategories.length > 0 ? dbCategories : [...PRODUCT_CATEGORIES];
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [category, setCategory] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('');
  const [statusFilter, setStatusFilter] = useState<'' | ProductStatus>('');
  const [sortBy, setSortBy] = useState<ProductSortField>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(GRID_PAGE_SIZE);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [exporting, setExporting] = useState(false);

  // sentinel ref for infinite scroll
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { data: suppliersData } = useSuppliers({ pageSize: DROPDOWN_PAGE_SIZE });
  const { data: discountRules = [] } = useDiscountRules(true);
  const suppliers = suppliersData?.data ?? [];

  // Shared query params (no page — used for infinite + list)
  const sharedParams = {
    search: debouncedSearch || undefined,
    category: category || undefined,
    supplierId: supplierId || undefined,
    status: statusFilter || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortBy ? sortOrder : undefined,
  };

  const handleSort = (field: ProductSortField) => {
    if (!field) return;
    if (sortBy === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(0);
  };

  const handlePriceSort = (order: 'asc' | 'desc') => {
    setSortBy('sellingPrice');
    setSortOrder(order);
    setPage(0);
  };

  // ── Infinite query (grid) ────────────────────────────────────────────────────
  const {
    data: infiniteData,
    isLoading: infiniteLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteProducts(sharedParams, { enabled: viewMode === 'grid' });

  // ── Paged query (sheet) ─────────────────────────────────────────────────────
  const { data: pagedData, isLoading: pagedLoading } = useProducts(
    { ...sharedParams, page: page + 1, pageSize },
    { enabled: viewMode === 'sheet' },
  );

  // ── Flatten infinite pages for grid ─────────────────────────────────────────
  const allGridProducts = infiniteData?.pages.flatMap((p) => p.data) ?? [];

  const filteredGridProducts = filterByStock(allGridProducts, stockFilter);

  // ── Sheet products (paged) ──────────────────────────────────────────────────
  const listProducts = pagedData?.data ?? [];

  const discountMap = useMemo(
    () => buildProductDiscountMap(
      viewMode === 'grid' ? filteredGridProducts : listProducts,
      discountRules,
    ),
    [viewMode, filteredGridProducts, listProducts, discountRules],
  );

  // ── IntersectionObserver sentinel ───────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'grid') return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const resetFilters = (newViewMode?: ViewMode) => {
    setPage(0);
    if (newViewMode) {
      setViewMode(newViewMode);
      setPageSize(newViewMode === 'grid' ? GRID_PAGE_SIZE : SHEET_PAGE_SIZE);
    }
  };

  const isSheetView = viewMode === 'sheet';

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const all: Product[] = [];
      let pageNum = 1;
      let totalPages = 1;
      do {
        const res = await productService.getAll({
          ...sharedParams,
          page: pageNum,
          pageSize: 100,
          includeImages: true,
          lean: false,
        });
        all.push(...res.data);
        totalPages = res.totalPages ?? 1;
        pageNum += 1;
      } while (pageNum <= totalPages);

      const filtered = filterByStock(all, stockFilter);
      const { count, skippedEmbeddedImages } = exportProductsToExcel(filtered);
      showSuccess(
        `Exported ${count} product${count === 1 ? '' : 's'} `
        + '(Bulk Add columns — import on Bulk Add).',
      );
      if (skippedEmbeddedImages > 0) {
        showWarning(
          `${skippedEmbeddedImages} uploaded (embedded) image${skippedEmbeddedImages === 1 ? '' : 's'} `
          + 'omitted — Excel cannot store base64 images. Use image URLs for round-trip export.',
        );
      }
    } catch (err) {
      showApiError(err, 'Could not export products.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box
      sx={isSheetView ? {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      } : undefined}
    >
      <PageHeader
        title="Products"
        subtitle={`${pagedData?.total ?? (infiniteData?.pages[0]?.total ?? 0)} products in catalog`}
        action={
          canManage ? (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Same columns as Bulk Add Import — edit offline, then Import on Bulk Add">
                <span>
                  <Button
                    variant="outlined"
                    startIcon={<FileDownloadIcon />}
                    onClick={() => void handleExportExcel()}
                    loading={exporting}
                    disabled={exporting}
                  >
                    Export Excel
                  </Button>
                </span>
              </Tooltip>
              <Button variant="outlined" startIcon={<ContentPasteIcon />} onClick={() => navigate('/products/bulk-add')}>
                Bulk Add
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/products/new')}>
                Add Product
              </Button>
            </Box>
          ) : undefined
        }
      />

      {/* ── Toolbar ── */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); resetFilters(); }}
            placeholder="Search by name, SKU, barcode..."
          />
        </Box>

        {/* Category */}
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Category</InputLabel>
          <Select
            label="Category"
            value={category}
            onChange={(e) => { setCategory(e.target.value); resetFilters(); }}
          >
            <MenuItem value="">All Categories</MenuItem>
            {categoryOptions.map((c) => (
              <MenuItem key={c} value={c}>{c}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Supplier */}
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Supplier</InputLabel>
          <Select
            label="Supplier"
            value={supplierId}
            onChange={(e) => { setSupplierId(e.target.value); resetFilters(); }}
          >
            <MenuItem value="">All Suppliers</MenuItem>
            {suppliers.map((s) => (
              <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Product status */}
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as '' | ProductStatus); resetFilters(); }}
          >
            <MenuItem value="">All Statuses</MenuItem>
            {PRODUCT_STATUS_OPTIONS.map((s) => (
              <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Stock status quick filter */}
        <ToggleButtonGroup
          value={stockFilter}
          exclusive
          size="small"
          onChange={(_, v: StockFilter) => setStockFilter(v ?? '')}
        >
          <ToggleButton value="">All</ToggleButton>
          <ToggleButton value="in">In Stock</ToggleButton>
          <ToggleButton value="low">Low</ToggleButton>
          <ToggleButton value="out">Out</ToggleButton>
        </ToggleButtonGroup>

        {/* Newest products */}
        <ToggleButton
          value="new"
          selected={sortBy === 'createdAt' && sortOrder === 'desc'}
          size="small"
          onClick={() => {
            if (sortBy === 'createdAt' && sortOrder === 'desc') {
              setSortBy('');
              setSortOrder('asc');
            } else {
              setSortBy('createdAt');
              setSortOrder('desc');
            }
            setPage(0);
          }}
        >
          New
        </ToggleButton>

        {/* Price sort */}
        <ToggleButtonGroup
          value={sortBy === 'sellingPrice' ? sortOrder : ''}
          exclusive
          size="small"
          onChange={(_, v: 'asc' | 'desc' | '') => {
            if (v) handlePriceSort(v);
          }}
        >
          <Tooltip title="Price: Low to High">
            <ToggleButton value="asc" aria-label="Price ascending">
              <ArrowUpwardIcon fontSize="small" sx={{ mr: 0.5 }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Price</Typography>
            </ToggleButton>
          </Tooltip>
          <Tooltip title="Price: High to Low">
            <ToggleButton value="desc" aria-label="Price descending">
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Price</Typography>
              <ArrowDownwardIcon fontSize="small" sx={{ ml: 0.5 }} />
            </ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>

        {/* View toggle */}
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          size="small"
          onChange={(_, v: ViewMode) => { if (v) resetFilters(v); }}
        >
          <ToggleButton value="grid" aria-label="Grid view">
            <Tooltip title="Grid view">
              <GridViewIcon fontSize="small" />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="sheet" aria-label="Bulk Edit">
            <Tooltip title="Bulk Edit">
              <TableRowsIcon fontSize="small" />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* ── Grid view (infinite scroll) ── */}
      {viewMode === 'grid' && (
        <Box>
          {infiniteLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : filteredGridProducts.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
              No products found
            </Typography>
          ) : (
            <Grid container spacing={2}>
              {filteredGridProducts.map((product) => (
                <Grid key={product.id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                  <ProductGridCard
                    product={product}
                    discountLabel={discountMap.get(product.id)}
                    onClick={() => navigate(`/products/${product.id}`)}
                  />
                </Grid>
              ))}
            </Grid>
          )}

          {/* Sentinel + load-more indicator (only after first page renders) */}
          {!infiniteLoading && filteredGridProducts.length > 0 && (
            <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              {isFetchingNextPage && <CircularProgress size={24} />}
              {!isFetchingNextPage && !hasNextPage && (
                <Typography variant="caption" color="text.disabled">
                  All products loaded
                </Typography>
              )}
            </Box>
          )}
        </Box>
      )}

      {viewMode === 'sheet' && (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <ProductSheetView
            products={listProducts}
            loading={pagedLoading}
            page={page}
            pageSize={pageSize}
            total={pagedData?.total}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
            filters={sharedParams}
            stockFilter={stockFilter}
            canCreatePo={canCreatePo}
            canBulkEdit={canManage}
            sortBy={sortBy || undefined}
            sortOrder={sortOrder}
            onSort={(field) => handleSort(field)}
          />
        </Box>
      )}
    </Box>
  );
}
