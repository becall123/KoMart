import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  TextField,
  InputAdornment,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Divider,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  Chip,
  CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import PaymentIcon from '@mui/icons-material/Payment';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateCommerceQueries, patchProductStockInCache } from '@/hooks/invalidateCommerce';

import { useInfiniteProducts } from '@/hooks/useProducts';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useEvaluateDiscounts } from '@/hooks/useDiscounts';
import { useCreateCustomer, useCustomer } from '@/hooks/useCustomers';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useCartStore, useAuthStore } from '@/store';
import { transactionService } from '@/services';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess, showWarning, showApiError } from '@/utils/toast';
import { formatAmount, formatCurrency } from '@/utils';
import { DROPDOWN_PAGE_SIZE, POS_PRODUCTS_PAGE_SIZE, PRODUCT_CATEGORIES } from '@/constants';
import { useStoreSettings } from '@/hooks/useSettings';
import { receiptBrandingFromSettings } from '@/utils/receiptPrint';
import { cartLineKey } from '@/utils/cartLine';
import { uomLabel } from '@/utils';
import { canSellAsPack, canSellAsPiece, isPosSellableProduct, packSellOption, pieceSellOption, resolveSellOption } from '@/utils/uomSell';
import { PaymentModal, type PaymentConfirmPayload } from '@/components/pos/PaymentModal';
import { PosAddProductAutocomplete } from '@/components/pos/PosAddProductAutocomplete';
import { resolvePosProductByScan } from '@/components/pos/posProductLookup';
import { PriceWithUom } from '@/components/products/PriceWithUom';
import { ProductQuickViewDialog } from '@/components/products/ProductQuickViewDialog';
import { DRAWER_COLLAPSED } from '@/layouts/Sidebar';
import { NepaliAwareDatePicker } from '@/components/common/NepaliAwareDatePicker';
import type { Product, Transaction, CartItem } from '@/types';

const CART_EXPANDED_WIDTH = 'clamp(340px, 42vw, 600px)';

const qtyBadgeSx = {
  '& .MuiBadge-badge': {
    fontWeight: 800,
    fontSize: '0.8rem',
    minWidth: 22,
    height: 22,
    px: 0.5,
    bgcolor: 'error.main',
    color: 'error.contrastText',
    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
    border: '2px solid',
    borderColor: 'background.paper',
  },
} as const;

interface CreateCustForm { name: string; phone: string; email: string }
const EMPTY_FORM: CreateCustForm = { name: '', phone: '', email: '' };

interface CollapsedCartRailProps {
  totalUnits: number;
  total: number;
  hasItems: boolean;
  onExpand: () => void;
  onPay: () => void;
}

interface ProductCardProps {
  product: Product;
  qtyInCart: number;
  onAdd: (product: Product, asPack?: boolean) => void;
  onViewDetails: (product: Product) => void;
}

const POS_IMAGE_CHIP_SX = {
  height: 18,
  fontSize: '0.55rem',
  fontWeight: 700,
  bgcolor: 'rgba(0,0,0,0.62)',
  color: 'common.white',
  border: '1px solid rgba(255,255,255,0.2)',
  backdropFilter: 'blur(4px)',
  '& .MuiChip-label': { px: 0.6 },
  maxWidth: '100%',
} as const;

const ProductCard = memo(function ProductCard({ product, qtyInCart, onAdd, onViewDetails }: ProductCardProps) {
  const [sellAsPack, setSellAsPack] = useState(false);
  const dualSell = canSellAsPack(product) && canSellAsPiece(product);
  const packOnly = canSellAsPack(product) && !canSellAsPiece(product);
  const displayOption = dualSell
    ? (sellAsPack ? (packSellOption(product) ?? pieceSellOption(product)) : pieceSellOption(product))
    : resolveSellOption(product, packOnly);
  const inCart = qtyInCart > 0;
  const notBillable = displayOption.price <= 0;
  const stockColor =
    product.stock === 0 ? 'error' : product.stock <= product.lowStockThreshold ? 'warning' : 'success';
  const stockLabel =
    product.stock === 0
      ? 'Out'
      : product.stock <= product.lowStockThreshold
        ? `Low: ${product.stock}`
        : String(product.stock);
  const visibleTags = (product.tags ?? []).slice(0, 2);
  const hiddenTagCount = Math.max(0, (product.tags ?? []).length - visibleTags.length);
  const cardDisabled = product.stock === 0 || notBillable;

  const handleAdd = () => onAdd(product, packOnly || (dualSell && sellAsPack));

  const sellAsToggleSx = {
    width: '100%',
    '& .MuiToggleButton-root': {
      px: 1,
      py: 0.4,
      fontSize: '0.75rem',
      lineHeight: 1.25,
      flex: 1,
      textTransform: 'none',
      fontWeight: 600,
      bgcolor: 'action.hover',
    },
    '& .MuiToggleButton-root.Mui-selected': {
      bgcolor: 'primary.main',
      color: 'primary.contrastText',
      fontWeight: 700,
      borderColor: 'primary.main',
      '&:hover': { bgcolor: 'primary.dark' },
    },
  } as const;

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        opacity: cardDisabled ? 0.45 : 1,
        border: inCart ? 2 : 0,
        borderColor: 'primary.main',
      }}
    >
      <CardActionArea
        onClick={handleAdd}
        disabled={cardDisabled}
        sx={{
          flexShrink: 0,
          '&:hover .pos-product-image': cardDisabled ? {} : { opacity: 0.88 },
        }}
      >
        {/* Image section with qty overlay — only tap target for add-to-cart */}
        <Box
          className="pos-product-image"
          sx={{ position: 'relative', transition: 'opacity 0.15s' }}
        >
          {product.images[0] ? (
            <Box
              component="img"
              src={product.images[0]}
              alt={product.name}
              loading="lazy"
              decoding="async"
              sx={{
                width: '100%',
                height: 110,
                objectFit: 'contain',
                objectPosition: 'center',
                display: 'block',
                bgcolor: 'action.hover',
              }}
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                height: 110,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
                fontSize: '1.75rem',
                fontWeight: 700,
                color: 'text.disabled',
                userSelect: 'none',
              }}
            >
              {(product.name[0] ?? '?').toUpperCase()}
            </Box>
          )}
          {qtyInCart > 0 && (
            <Box
              sx={{
                position: 'absolute',
                top: 6,
                right: 6,
                minWidth: 22,
                height: 22,
                px: 0.5,
                borderRadius: '11px',
                bgcolor: 'error.main',
                color: 'error.contrastText',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '0.8rem',
                lineHeight: 1,
                boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                border: '2px solid',
                borderColor: 'background.paper',
                zIndex: 2,
              }}
            >
              {qtyInCart}
            </Box>
          )}

          {product.category && (
            <Box sx={{ position: 'absolute', top: 6, left: 6, zIndex: 1, maxWidth: 'calc(100% - 40px)' }}>
              <Chip label={product.category} size="small" sx={POS_IMAGE_CHIP_SX} />
            </Box>
          )}

          <Box
            sx={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              right: 6,
              zIndex: 1,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 0.5,
            }}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, minWidth: 0, flex: '1 1 auto', pr: 0.5 }}>
              {visibleTags.map((tag) => (
                <Chip key={tag} label={tag} size="small" sx={POS_IMAGE_CHIP_SX} />
              ))}
              {hiddenTagCount > 0 && (
                <Chip label={`+${hiddenTagCount}`} size="small" sx={POS_IMAGE_CHIP_SX} />
              )}
            </Box>
            <IconButton
              size="small"
              aria-label="View product details"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onViewDetails(product);
              }}
              sx={{
                width: 28,
                height: 28,
                flexShrink: 0,
                bgcolor: 'rgba(0,0,0,0.62)',
                color: 'common.white',
                border: '1px solid rgba(255,255,255,0.2)',
                backdropFilter: 'blur(4px)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.78)' },
              }}
            >
              <VisibilityIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Box>
      </CardActionArea>

      {/* Info section — not clickable for add-to-cart */}
      <CardContent
        sx={{
          p: 1.25,
          pt: 1,
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          cursor: 'default',
          '&:last-child': { pb: 1.25 },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            lineHeight: 1.3,
            fontSize: '0.8rem',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
          }}
          title={product.name}
        >
          {product.name}
        </Typography>
        {dualSell && (
          <Box sx={{ width: '100%' }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: '0.7rem', fontWeight: 600, display: 'block', mb: 0.35 }}
            >
              Sell as
            </Typography>
            <ToggleButtonGroup
              value={sellAsPack ? 'pack' : 'piece'}
              exclusive
              size="small"
              fullWidth
              onChange={(_, v: 'piece' | 'pack' | null) => {
                if (v) setSellAsPack(v === 'pack');
              }}
              sx={sellAsToggleSx}
            >
              <ToggleButton value="piece">{uomLabel(product.uom || product.buyUom || '')}</ToggleButton>
              <ToggleButton value="pack">{uomLabel(product.buyUom || '')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}
        {packOnly && !dualSell && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem', fontWeight: 600 }}>
            Sell as: {uomLabel(product.buyUom || '')}
          </Typography>
        )}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 0.5,
            mt: 'auto',
            minWidth: 0,
          }}
        >
          <Box sx={{ minWidth: 0, overflow: 'hidden', flex: '1 1 auto' }}>
            <PriceWithUom
              price={displayOption.price}
              uom={displayOption.sellUom}
              priceSx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}
            />
          </Box>
          <Chip
            label={stockLabel}
            color={stockColor}
            size="small"
            sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}
          />
        </Box>
      </CardContent>
    </Card>
  );
});

interface CartQtyStepperProps {
  quantity: number;
  onDecrement: () => void;
  onIncrement: () => void;
}

const CartQtyStepper = memo(function CartQtyStepper({
  quantity,
  onDecrement,
  onIncrement,
}: CartQtyStepperProps) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        flexShrink: 0,
        touchAction: 'manipulation',
      }}
    >
      <IconButton
        type="button"
        size="small"
        aria-label="Decrease quantity"
        onClick={(e) => {
          e.stopPropagation();
          onDecrement();
        }}
        sx={{ p: 0.35, width: 24, height: 24 }}
      >
        <RemoveIcon sx={{ fontSize: 13, pointerEvents: 'none' }} />
      </IconButton>
      <Typography
        component="span"
        variant="body2"
        sx={{
          minWidth: 24,
          textAlign: 'center',
          fontWeight: 800,
          fontSize: '0.75rem',
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
          lineHeight: 1.4,
          px: 0.5,
          py: 0.25,
          borderRadius: 1,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
        }}
      >
        {quantity}
      </Typography>
      <IconButton
        type="button"
        size="small"
        aria-label="Increase quantity"
        onClick={(e) => {
          e.stopPropagation();
          onIncrement();
        }}
        sx={{ p: 0.35, width: 24, height: 24 }}
      >
        <AddIcon sx={{ fontSize: 13, pointerEvents: 'none' }} />
      </IconButton>
    </Box>
  );
});

function CollapsedCartRail({ totalUnits, total, hasItems, onExpand, onPay }: CollapsedCartRailProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        py: 1,
        gap: 1.5,
      }}
    >
      <Tooltip title="Expand cart" placement="left">
        <IconButton onClick={onExpand} size="small">
          <ChevronLeftIcon />
        </IconButton>
      </Tooltip>

      <Tooltip title="View cart" placement="left">
        <IconButton onClick={onExpand} sx={{ my: 1 }}>
          <Badge badgeContent={totalUnits} invisible={totalUnits === 0} sx={qtyBadgeSx}>
            <ShoppingCartIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Typography
        variant="caption"
        sx={{
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          transform: 'rotate(180deg)',
          fontWeight: 700,
          color: 'primary.main',
          fontSize: '0.7rem',
          letterSpacing: 0.5,
          flex: 1,
        }}
      >
        {formatCurrency(total)}
      </Typography>

      <Tooltip title={hasItems ? 'Pay' : 'Cart is empty'} placement="left">
        <span>
          <IconButton color="primary" disabled={!hasItems} onClick={onPay}>
            <PaymentIcon />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

export function POSPage() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [supplierIdFilter, setSupplierIdFilter] = useState('');
  const [popularOnly, setPopularOnly] = useState(false);
  const [trendingOnly, setTrendingOnly] = useState(false);
  const [priceSort, setPriceSort] = useState<'asc' | 'desc' | ''>('');
  const productGridSentinelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const cartSnapshotRef = useRef<{ items: CartItem[]; customerId: string | null; saleDate: string } | null>(null);
  const [cartCollapsed, setCartCollapsed] = useState(isMobile);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receipt, setReceipt] = useState<Transaction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [tenderedAmount, setTenderedAmount] = useState<number | undefined>(undefined);
  const [barcodeLookupBusy, setBarcodeLookupBusy] = useState(false);

  // Quick-create customer dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [custForm, setCustForm] = useState<CreateCustForm>(EMPTY_FORM);
  const [custFormError, setCustFormError] = useState('');
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  const queryClient = useQueryClient();
  const { items, addItem, removeItem, updateQuantity, customerId, setCustomer, clearCart, replaceCart, saleDate, setSaleDate } = useCartStore();

  const cartMutators = useMemo(
    () => ({ updateQuantity, removeItem, addItem }),
    [updateQuantity, removeItem, addItem],
  );

  // Backspace = remove last cart item (when not typing in an input)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;
      if (e.key === 'Backspace' && !isEditable && items.length > 0) {
        const last = items[items.length - 1];
        removeItem(last.productId, last.sellUom);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, removeItem]);
  const user = useAuthStore((s) => s.user);
  const { data: storeSettings } = useStoreSettings();
  const receiptBranding = storeSettings ? receiptBrandingFromSettings(storeSettings) : undefined;
  const createCustomerMutation = useCreateCustomer();

  const {
    data: infiniteProductsData,
    isLoading: productsLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteProducts({
    search: debouncedSearch || undefined,
    category: categoryFilter || undefined,
    supplierId: supplierIdFilter || undefined,
    isPopular: popularOnly || undefined,
    isTrending: trendingOnly || undefined,
    sellableOnly: true,
    pageSize: POS_PRODUCTS_PAGE_SIZE,
  });
  const { data: paymentCustomer } = useCustomer(customerId ?? '');
  const { data: suppliersData } = useSuppliers({ pageSize: DROPDOWN_PAGE_SIZE });
  const suppliers = suppliersData?.data ?? [];

  const products = infiniteProductsData?.pages.flatMap((p) => p.data) ?? [];

  useEffect(() => {
    const el = productGridSentinelRef.current;
    if (!el || productsLoading) return;

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
  }, [productsLoading, hasNextPage, isFetchingNextPage, fetchNextPage, products.length]);

  const productCategoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of products) map[p.id] = p.category;
    return map;
  }, [products]);

  const cartItemsForDiscount = useMemo(
    () => items.map((i) => ({
      ...i,
      category: i.category ?? productCategoryMap[i.productId] ?? '',
    })),
    [items, productCategoryMap],
  );

  const { data: discountEval } = useEvaluateDiscounts(cartItemsForDiscount, '');

  const addableProducts = useMemo(
    () => products.filter(isPosSellableProduct),
    [products],
  );

  const displayedProducts = useMemo(() => addableProducts
    .filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (supplierIdFilter && p.supplierId !== supplierIdFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (priceSort === 'asc') return a.sellingPrice - b.sellingPrice;
      if (priceSort === 'desc') return b.sellingPrice - a.sellingPrice;
      return 0;
    }), [addableProducts, categoryFilter, supplierIdFilter, priceSort]);

  const cartQuantities = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.productId, item.quantity);
    return map;
  }, [items]);

  // ── Cart totals (prices are tax-inclusive — no separate tax line) ──────────
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const promotionLineDiscount = discountEval?.lineDiscountTotal ?? 0;
  const promotionCartDiscount = discountEval?.cartDiscount ?? 0;
  const totalDiscount = promotionLineDiscount + promotionCartDiscount;
  const total = Math.max(0, subtotal - totalDiscount);
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);

  const paymentCustomerInfo = useMemo(() => {
    if (!customerId || !paymentCustomer) {
      return { name: 'Walk-In Customer', isWalkIn: true as const };
    }
    return {
      name: paymentCustomer.name,
      phone: paymentCustomer.phone,
      email: paymentCustomer.email || undefined,
      membershipTier: paymentCustomer.membershipTier,
      loyaltyPoints: paymentCustomer.loyaltyPoints,
      isWalkIn: false as const,
    };
  }, [customerId, paymentCustomer]);

  const openPaymentModal = useCallback(() => {
    if (items.length === 0) return;
    cartSnapshotRef.current = {
      items: items.map((i) => ({ ...i })),
      customerId,
      saleDate,
    };
    setPaymentError('');
    setPaymentOpen(true);
  }, [items, customerId, saleDate]);

  const handleCollapsedPay = () => {
    if (items.length === 0) return;
    setCartCollapsed(false);
    openPaymentModal();
  };

  const handleAddProduct = useCallback((product: Product, asPack = false) => {
    const opt = resolveSellOption(product, asPack);
    if (opt.price <= 0) return;
    addItem({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      image: product.images[0],
      price: opt.price,
      quantity: 1,
      discount: 0,
      sellUom: opt.sellUom,
      unitFactor: opt.unitFactor,
      uom: product.uom || product.buyUom || '',
      category: product.category,
    });
  }, [addItem]);

  const handleBarcodeScan = useCallback(async () => {
    const code = search.trim();
    if (!code || barcodeLookupBusy || paymentOpen) return;

    setBarcodeLookupBusy(true);
    try {
      const product = await resolvePosProductByScan(code, products);

      if (!product) {
        showWarning(`No product for barcode “${code}”.`);
        return;
      }

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

      handleAddProduct(product, packOnly);
      setSearch('');
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } catch (err) {
      showApiError(err, 'Could not look up barcode.');
    } finally {
      setBarcodeLookupBusy(false);
    }
  }, [
    search,
    barcodeLookupBusy,
    paymentOpen,
    products,
    handleAddProduct,
  ]);

  const handleQtyChange = useCallback((productId: string, newQty: number, sellUom?: string) => {
    if (isNaN(newQty) || newQty < 1) {
      updateQuantity(productId, 0, sellUom);
      return;
    }
    updateQuantity(productId, newQty, sellUom);
  }, [updateQuantity]);

  // ── Payment ────────────────────────────────────────────────────────────────
  const handlePayment = async (payload: PaymentConfirmPayload) => {
    if (payload.items.length === 0) return;
    setPaymentError('');
    setTenderedAmount(payload.tendered);
    setProcessing(true);
    try {
      const txn = await transactionService.create({
        customerId: customerId ?? undefined,
        customerName: paymentCustomer?.name ?? 'Walk-In',
        items: payload.items,
        subtotal: payload.subtotal,
        promotionDiscount: payload.promotionDiscount,
        manualDiscount: payload.manualDiscount,
        appliedPromotions: payload.appliedPromotions,
        discount: payload.discount,
        tax: 0,
        loyaltyPointsRedeemed: payload.loyaltyPointsRedeemed,
        total: payload.total,
        paymentMethod: payload.method,
        notes: payload.notes || undefined,
        saleDate,
        createdBy: user?.name ?? 'Cashier',
        roundOff: payload.roundOff || undefined,
      });
      setReceipt(txn);
      showSuccess('Sale completed — POS and Dashboard will reflect changes shortly.');
      const soldIds: string[] = [];
      for (const item of payload.items) {
        const baseQty = item.quantity * (item.unitFactor ?? 1);
        soldIds.push(item.productId);
        patchProductStockInCache(queryClient, item.productId, baseQty);
      }
      invalidateCommerceQueries(queryClient, {
        scopes: ['sale'],
        productIds: [...new Set(soldIds)],
      });
    } catch (err) {
      setPaymentError(getErrorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const handleNewSale = () => {
    clearCart();
    setReceipt(null);
    setPaymentOpen(false);
    setSearch('');
    setTenderedAmount(undefined);
  };

  // ── Quick create customer ─────────────────────────────────────────────────
  const handleCreateCustomer = async () => {
    if (!custForm.name.trim()) { setCustFormError('Name is required'); return; }
    if (!custForm.phone.trim()) { setCustFormError('Phone is required'); return; }
    try {
      const created = await createCustomerMutation.mutateAsync({
        name: custForm.name.trim(),
        phone: custForm.phone.trim(),
        email: custForm.email.trim(),
      });
      setCustomer(created.id);
      showSuccess('Customer created.');
      setCreateOpen(false);
      setCustForm(EMPTY_FORM);
      setCustFormError('');
    } catch (err) {
      setCustFormError(getErrorMessage(err));
    }
  };

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        minHeight: 0,
        maxHeight: 'calc(100dvh - 88px)',
        height: 'calc(100dvh - 88px)',
        width: '100%',
        gap: 0,
        overflow: 'hidden',
      }}
    >
      {/* ── Left: Product Grid (fills all space left of cart) ── */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          pr: { xs: 1.5, sm: 2 },
          overflow: 'hidden',
        }}
      >
        <Paper sx={{ p: 2, mb: 2 }}>
          <TextField
            fullWidth
            inputRef={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void handleBarcodeScan();
            }}
            autoFocus={!isMobile && !paymentOpen}
            placeholder="Search products or scan barcode..."
            size="small"
            disabled={barcodeLookupBusy}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    {barcodeLookupBusy ? (
                      <CircularProgress size={18} sx={{ mr: 0.5 }} />
                    ) : (
                      <Tooltip title="Focus for barcode scanner">
                        <IconButton
                          size="small"
                          aria-label="Focus for barcode scanner"
                          onClick={() => searchInputRef.current?.focus()}
                        >
                          <QrCodeScannerIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </InputAdornment>
                ),
              },
            }}
          />
        </Paper>

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Category</InputLabel>
            <Select
              value={categoryFilter}
              label="Category"
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              {PRODUCT_CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Supplier</InputLabel>
            <Select
              value={supplierIdFilter}
              label="Supplier"
              onChange={(e) => setSupplierIdFilter(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              {suppliers.map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Chip
            label="Most Popular"
            size="small"
            variant={popularOnly ? 'filled' : 'outlined'}
            color={popularOnly ? 'secondary' : 'default'}
            onClick={() => setPopularOnly((v) => !v)}
            sx={{ fontWeight: 600 }}
          />
          <Chip
            label="Trending"
            size="small"
            variant={trendingOnly ? 'filled' : 'outlined'}
            color={trendingOnly ? 'secondary' : 'default'}
            onClick={() => setTrendingOnly((v) => !v)}
            sx={{ fontWeight: 600 }}
          />

          <ToggleButtonGroup
            value={priceSort}
            exclusive
            size="small"
            onChange={(_, v: 'asc' | 'desc' | null) => setPriceSort(v ?? '')}
            sx={{ '& .MuiToggleButton-root': { px: 1.25, py: 0.5 } }}
          >
            <ToggleButton value="asc">
              <ArrowUpwardIcon fontSize="small" sx={{ mr: 0.5 }} />
              Price
            </ToggleButton>
            <ToggleButton value="desc">
              <ArrowDownwardIcon fontSize="small" sx={{ mr: 0.5 }} />
              Price
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <Grid container spacing={1.5} columns={{ xs: 1, sm: 2, md: 3 }}>
            {displayedProducts.map((product) => (
              <Grid key={product.id} size={1}>
                <ProductCard
                  product={product}
                  qtyInCart={cartQuantities.get(product.id) ?? 0}
                  onAdd={handleAddProduct}
                  onViewDetails={setDetailProduct}
                />
              </Grid>
            ))}
            {displayedProducts.length === 0 && !productsLoading && (
              <Grid size={{ xs: 1, sm: 2, md: 3 }}>
                <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                  No products found
                </Typography>
              </Grid>
            )}
            {productsLoading && (
              <Grid size={{ xs: 1, sm: 2, md: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={28} />
                </Box>
              </Grid>
            )}
            {!productsLoading && hasNextPage && (
              <Grid size={{ xs: 1, sm: 2, md: 3 }}>
                <Box ref={productGridSentinelRef} sx={{ py: 2, textAlign: 'center' }}>
                  {isFetchingNextPage && <CircularProgress size={24} />}
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      </Box>

      {/* ── Right: Cart Panel (collapsible, flush to right edge) ── */}
      <Paper
        elevation={2}
        sx={(theme) => ({
          width: cartCollapsed ? DRAWER_COLLAPSED : CART_EXPANDED_WIDTH,
          flexShrink: 0,
          minWidth: 0,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          p: cartCollapsed ? 0.5 : { xs: 1.5, sm: 2 },
          borderRadius: '12px 0 0 12px',
          borderRight: 0,
          alignSelf: 'stretch',
          minHeight: 0,
          maxHeight: '100%',
          overflow: 'hidden',
          transition: theme.transitions.create('width'),
        })}
      >
        {cartCollapsed ? (
          <CollapsedCartRail
            totalUnits={totalUnits}
            total={total}
            hasItems={items.length > 0}
            onExpand={() => setCartCollapsed(false)}
            onPay={handleCollapsedPay}
          />
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
        {/* Cart header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minHeight: 44,
            py: 0.5,
            flexShrink: 0,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            Cart
          </Typography>
          <Badge badgeContent={totalUnits} invisible={totalUnits === 0} sx={qtyBadgeSx}>
            <ShoppingCartIcon fontSize="small" />
          </Badge>
          <Box sx={{ flex: 1 }} />
          {items.length > 0 && (
            <Button
              size="small"
              color="error"
              sx={{ minWidth: 0, px: 1 }}
              onClick={() => clearCart()}
            >
              Clear
            </Button>
          )}
          <Tooltip title="Collapse cart">
            <IconButton size="small" onClick={() => setCartCollapsed(true)} sx={{ flexShrink: 0 }}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ flexShrink: 0, mb: 1 }}>
          <NepaliAwareDatePicker
            label="Sale Date"
            value={saleDate}
            onChange={setSaleDate}
            size="small"
            fullWidth
          />
        </Box>

        {/* Cart items — scrollable middle section */}
        <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', mb: 0.5 }}>
          {items.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <ShoppingCartIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography color="text.secondary" variant="body2">
                Tap a product to add it
              </Typography>
            </Box>
          ) : (
            <TableContainer sx={{ width: '100%' }}>
              <Table
                size="small"
                sx={{
                  tableLayout: 'fixed',
                  width: '100%',
                  '& .MuiTableCell-root': {
                    verticalAlign: 'middle',
                    py: 0.75,
                    px: 0.5,
                    borderColor: 'divider',
                  },
                }}
              >
                <colgroup>
                  <col style={{ width: '6%' }} />
                  <col style={{ width: 'auto' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '8%' }} />
                </colgroup>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell align="center" sx={{ fontWeight: 700, px: 0.25, fontSize: '0.7rem' }}>SN</TableCell>
                    <TableCell sx={{ fontWeight: 700, pl: 0, pr: 0.5, fontSize: '0.7rem' }}>Item</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700, px: 0.25, fontSize: '0.7rem' }}>Qty</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700, px: 0.25, fontSize: '0.7rem' }}>UOM</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, px: 0.25, fontSize: '0.7rem' }}>Price</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, px: 0.25, fontSize: '0.7rem' }}>Total</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700, px: 0, width: 32 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item, index) => {
                    return (
                      <TableRow key={cartLineKey(item.productId, item.sellUom)} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                        <TableCell align="center" sx={{ px: 0.25 }}>
                          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                            {index + 1}
                          </Typography>
                        </TableCell>

                        <TableCell sx={{ pl: 0, pr: 0.5, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 600,
                              fontSize: '0.8125rem',
                              lineHeight: 1.35,
                              wordBreak: 'break-word',
                            }}
                          >
                            {item.name}
                          </Typography>
                        </TableCell>

                        <TableCell align="center" sx={{ px: 0.25 }}>
                          <CartQtyStepper
                            quantity={item.quantity}
                            onDecrement={() => handleQtyChange(item.productId, item.quantity - 1, item.sellUom)}
                            onIncrement={() => handleQtyChange(item.productId, item.quantity + 1, item.sellUom)}
                          />
                        </TableCell>

                        <TableCell align="center" sx={{ px: 0.25 }}>
                          <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 600 }}>
                            {uomLabel(item.sellUom || item.uom || '')}
                          </Typography>
                        </TableCell>

                        <TableCell align="right" sx={{ px: 0.25 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: '0.75rem',
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatAmount(item.price)}
                          </Typography>
                        </TableCell>

                        <TableCell align="right" sx={{ px: 0.25 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 600,
                              fontSize: '0.75rem',
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatAmount(item.price * item.quantity)}
                          </Typography>
                        </TableCell>

                        <TableCell align="center" sx={{ px: 0, width: 32 }}>
                          <IconButton
                            type="button"
                            size="small"
                            color="error"
                            aria-label="Remove item"
                            onClick={() => removeItem(item.productId, item.sellUom)}
                            sx={{ width: 24, height: 24, p: 0 }}
                          >
                            <DeleteIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>

        <Box sx={{ flexShrink: 0, mb: 1 }}>
          <PosAddProductAutocomplete onAdd={handleAddProduct} />
        </Box>

        {/* Footer: totals + pay — always visible */}
        <Box sx={{ flexShrink: 0, pt: 0.5, bgcolor: 'background.paper', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
        <Divider sx={{ mb: 1 }} />

        <Box sx={{ mb: 1.25 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 24, mb: 0.75 }}>
            <Typography variant="body2" color="text.secondary">Subtotal</Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatAmount(subtotal)}
            </Typography>
          </Box>

          {(discountEval?.appliedPromotions.length ?? 0) > 0 && (
            <Box sx={{ mb: 0.75 }}>
              {discountEval?.appliedPromotions.map((promo) => (
                <Box key={promo.ruleId} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography variant="caption" color="success.main">{promo.name}</Typography>
                  <Typography variant="caption" color="success.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    - {formatAmount(promo.amount)}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          <Divider sx={{ mb: 0.75 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>Total</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} color="primary">
              {formatCurrency(total)}
            </Typography>
          </Box>
        </Box>

        <Button
          fullWidth
          variant="contained"
          size="large"
          disabled={items.length === 0}
          onClick={openPaymentModal}
          sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}
        >
          Pay {formatCurrency(total)}
        </Button>
        </Box>
          </Box>
        )}
      </Paper>

      {/* ── Payment modal (transitions to receipt on success) ─────────────── */}
      <PaymentModal
        open={paymentOpen}
        items={items}
        cartMutators={cartMutators}
        productCategoryMap={productCategoryMap}
        customerId={customerId}
        onCustomerChange={setCustomer}
        onAddCustomer={() => { setCustForm(EMPTY_FORM); setCustFormError(''); setCreateOpen(true); }}
        customer={paymentCustomerInfo}
        saleDate={saleDate}
        loading={processing}
        error={paymentError}
        transaction={receipt}
        tenderedAmount={tenderedAmount}
        defaultPaymentMethod={storeSettings?.defaultPaymentMethod}
        autoPrint={storeSettings?.autoPrint}
        receiptBranding={receiptBranding}
        onConfirm={handlePayment}
        onClose={() => {
          if (!receipt && cartSnapshotRef.current) {
            replaceCart(
              cartSnapshotRef.current.items,
              cartSnapshotRef.current.customerId,
              cartSnapshotRef.current.saleDate,
            );
            cartSnapshotRef.current = null;
          }
          if (!receipt) setPaymentOpen(false);
        }}
        onNewSale={handleNewSale}
      />

      {/* ── Quick-create customer dialog ───────────────────────────────────── */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>New Customer</DialogTitle>
        <DialogContent>
          {custFormError && <Alert severity="error" sx={{ mb: 2 }}>{custFormError}</Alert>}
          <TextField
            label="Full Name"
            value={custForm.name}
            onChange={(e) => { setCustForm((f) => ({ ...f, name: e.target.value })); setCustFormError(''); }}
            fullWidth
            margin="normal"
            required
            autoFocus
          />
          <TextField
            label="Phone Number"
            value={custForm.phone}
            onChange={(e) => { setCustForm((f) => ({ ...f, phone: e.target.value })); setCustFormError(''); }}
            fullWidth
            margin="normal"
            required
          />
          <TextField
            label="Email (optional)"
            value={custForm.email}
            onChange={(e) => setCustForm((f) => ({ ...f, email: e.target.value }))}
            fullWidth
            margin="normal"
            type="email"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            loading={createCustomerMutation.isPending}
            onClick={() => void handleCreateCustomer()}
          >
            Create & Select
          </Button>
        </DialogActions>
      </Dialog>

      <ProductQuickViewDialog
        product={detailProduct}
        open={!!detailProduct}
        onClose={() => setDetailProduct(null)}
      />
    </Box>
  );
}
