import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import { useNavigate } from 'react-router-dom';
import { SearchBar } from '@/components/common/SearchBar';
import { ProductMetaChips } from '@/components/products/ProductMetaChips';
import { HeroCarousel } from '@/components/catalog/HeroCarousel';
import { useInfiniteCatalogProducts, useCatalogOffers, useCatalogTags, useStoreInfo } from '@/hooks/useCatalog';
import { buildCatalogDiscountMap, hasActiveDiscount } from '@/utils/catalogDiscounts';
import { formatCurrency, productStatusOf, productStatusLabel, productStatusColor } from '@/utils';
import { useCategoryNames } from '@/hooks/useCategories';
import type { CatalogProduct } from '@/types';

// ── Product Card ────────────────────────────────────────────────────────────

interface CatalogCardProps {
  product: CatalogProduct;
  discountLabel?: string | null;
  onClick: () => void;
}

const CatalogCard = memo(function CatalogCard({ product, discountLabel, onClick }: CatalogCardProps) {
  const outOfStock = product.inStock === false;

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 3,
        opacity: outOfStock ? 0.7 : 1,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        '&:hover': {
          transform: outOfStock ? 'none' : 'translateY(-4px)',
          boxShadow: outOfStock ? undefined : 6,
        },
      }}
    >
      <CardActionArea onClick={onClick} sx={{ flexGrow: 1 }}>
        <Box sx={{ position: 'relative' }}>
            {product.images[0] ? (
              <CardMedia
                component="img"
                image={product.images[0]}
                alt={product.name}
                loading="lazy"
                sx={{ height: 180, objectFit: 'cover', ...(outOfStock && { filter: 'grayscale(40%)' }) }}
              />
            ) : (
            <Box
              sx={{
                height: 180,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
                fontSize: '2.5rem',
                fontWeight: 700,
                color: 'text.disabled',
              }}
            >
              {product.name[0]?.toUpperCase()}
            </Box>
          )}
          {outOfStock && (
            <Chip
              label="Out of Stock"
              size="small"
              color="error"
              sx={{
                position: 'absolute',
                top: 8,
                left: 8,
                fontWeight: 700,
                fontSize: '0.65rem',
                height: 22,
              }}
            />
          )}
          {!outOfStock && discountLabel && (
            <Chip
              icon={<LocalOfferIcon sx={{ fontSize: '0.8rem !important' }} />}
              label={discountLabel}
              size="small"
              color="success"
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                fontWeight: 700,
                fontSize: '0.65rem',
                height: 22,
              }}
            />
          )}
        </Box>
        <CardContent sx={{ pb: 1.5, pt: 1.5 }}>
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

          {productStatusOf(product.status) === 'seasonal' && (
            <Chip
              label={productStatusLabel(product.status)}
              size="small"
              color={productStatusColor(product.status)}
              sx={{ mb: 0.75, height: 20, fontSize: '0.65rem' }}
            />
          )}

          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              color: outOfStock ? 'text.disabled' : 'primary.main',
              mt: 0.5,
              fontSize: '0.95rem',
            }}
          >
            {formatCurrency(product.sellingPrice)}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
});

// ── Page ────────────────────────────────────────────────────────────────────

export function CatalogPage() {
  const navigate = useNavigate();
  const categoryOptions = useCategoryNames();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [popularOnly, setPopularOnly] = useState(false);
  const [trendingOnly, setTrendingOnly] = useState(false);
  const [priceSort, setPriceSort] = useState<'asc' | 'desc' | ''>('');

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { data: offers = [] } = useCatalogOffers();
  const { data: tags = [] } = useCatalogTags();
  const { data: storeInfo } = useStoreInfo();

  const queryParams = {
    search: search || undefined,
    category: category || undefined,
    tag: selectedTag || undefined,
    isPopular: popularOnly || undefined,
    isTrending: trendingOnly || undefined,
    sortBy: priceSort ? 'selling_price' : undefined,
    sortOrder: (priceSort || undefined) as 'asc' | 'desc' | undefined,
  };

  const {
    data: infiniteData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteCatalogProducts(queryParams);

  const allProducts = infiniteData?.pages.flatMap((p) => p.data) ?? [];

  const filteredProducts = useMemo(() => {
    if (!onSaleOnly || offers.length === 0) return allProducts;
    return allProducts.filter((p) => hasActiveDiscount(p, offers));
  }, [allProducts, onSaleOnly, offers]);

  const discountMap = useMemo(
    () => buildCatalogDiscountMap(filteredProducts, offers),
    [filteredProducts, offers],
  );

  const totalCount = onSaleOnly
    ? filteredProducts.length
    : infiniteData?.pages[0]?.total ?? 0;

  useEffect(() => {
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
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <Box>
      {/* Hero Carousel */}
      <HeroCarousel offers={offers} storeInfo={storeInfo} />

      {/* Toolbar */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search products..."
          />
        </Box>

        <ToggleButtonGroup
          value={priceSort}
          exclusive
          size="small"
          onChange={(_, v: 'asc' | 'desc' | '') => setPriceSort(v ?? '')}
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

        <Chip
          icon={<LocalOfferIcon sx={{ fontSize: '1rem !important' }} />}
          label="On Sale"
          variant={onSaleOnly ? 'filled' : 'outlined'}
          color={onSaleOnly ? 'success' : 'default'}
          onClick={() => setOnSaleOnly(!onSaleOnly)}
          sx={{ fontWeight: 600, cursor: 'pointer' }}
        />
        <Chip
          label="Most Popular"
          variant={popularOnly ? 'filled' : 'outlined'}
          color={popularOnly ? 'secondary' : 'default'}
          onClick={() => setPopularOnly(!popularOnly)}
          sx={{ fontWeight: 600, cursor: 'pointer' }}
        />
        <Chip
          label="Trending"
          variant={trendingOnly ? 'filled' : 'outlined'}
          color={trendingOnly ? 'secondary' : 'default'}
          onClick={() => setTrendingOnly(!trendingOnly)}
          sx={{ fontWeight: 600, cursor: 'pointer' }}
        />

        <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
          {totalCount} product{totalCount !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Category chips */}
      <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
        <Chip
          label="All"
          size="small"
          variant={category === '' ? 'filled' : 'outlined'}
          color={category === '' ? 'secondary' : 'default'}
          onClick={() => setCategory('')}
          sx={{ fontWeight: 600, cursor: 'pointer' }}
        />
        {categoryOptions.map((c) => (
          <Chip
            key={c}
            label={c}
            size="small"
            variant={category === c ? 'filled' : 'outlined'}
            color={category === c ? 'secondary' : 'default'}
            onClick={() => setCategory(category === c ? '' : c)}
            sx={{ cursor: 'pointer' }}
          />
        ))}
      </Box>

      {/* Tag chips */}
      {tags.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
          {tags.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              variant={selectedTag === tag ? 'filled' : 'outlined'}
              color={selectedTag === tag ? 'info' : 'default'}
              onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>
      )}

      {/* Product Grid */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : filteredProducts.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
          No products found
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {filteredProducts.map((product) => (
            <Grid key={product.id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
              <CatalogCard
                product={product}
                discountLabel={discountMap.get(product.id)}
                onClick={() => navigate(`/catalog/${product.id}`)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Sentinel + loader */}
      <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        {isFetchingNextPage && <CircularProgress size={24} />}
        {!isFetchingNextPage && !hasNextPage && filteredProducts.length > 0 && (
          <Typography variant="caption" color="text.disabled">
            All products loaded
          </Typography>
        )}
      </Box>
    </Box>
  );
}
