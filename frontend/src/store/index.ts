import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode, User, DashboardWidgetLayout } from '@/types';
import { DEFAULT_DASHBOARD_LAYOUT } from '@/constants';
import { isMockEnabled, isMockSession } from '@/config/mock';

interface ThemeState {
  mode: ThemeMode;
  toggleMode: () => void;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'light',
      toggleMode: () =>
        set((state) => ({ mode: state.mode === 'light' ? 'dark' : 'light' })),
      setMode: (mode) => set({ mode }),
    }),
    { name: 'komart-theme' },
  ),
);

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      login: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken, isAuthenticated: true }),
      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'komart-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (
          state?.isAuthenticated &&
          !isMockEnabled() &&
          isMockSession(state.accessToken, state.refreshToken)
        ) {
          useAuthStore.setState({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
          });
        }
      },
    },
  ),
);

interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  notificationPanelOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setNotificationPanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarCollapsed: false,
      notificationPanelOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setNotificationPanelOpen: (open) => set({ notificationPanelOpen: open }),
    }),
    {
      name: 'komart-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);

interface DashboardState {
  layout: DashboardWidgetLayout[];
  dateRange: { startDate: string; endDate: string };
  setLayout: (layout: DashboardWidgetLayout[]) => void;
  resetLayout: () => void;
  setDateRange: (range: { startDate: string; endDate: string }) => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      layout: DEFAULT_DASHBOARD_LAYOUT,
      dateRange: {
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
      },
      setLayout: (layout) => set({ layout }),
      resetLayout: () => set({ layout: DEFAULT_DASHBOARD_LAYOUT }),
      setDateRange: (dateRange) => set({ dateRange }),
    }),
    { name: 'komart-dashboard', version: 1, partialize: (state) => ({ layout: state.layout }) },
  ),
);

import { cartLineKey } from '@/utils/cartLine';

function todayDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface CartState {
  items: import('@/types').CartItem[];
  customerId: string | null;
  loyaltyPointsRedeemed: number;
  saleDate: string;
  addItem: (item: import('@/types').CartItem) => void;
  removeItem: (productId: string, sellUom?: string) => void;
  updateQuantity: (productId: string, quantity: number, sellUom?: string) => void;
  updateDiscount: (productId: string, discount: number) => void;
  setCustomer: (customerId: string | null) => void;
  setLoyaltyPoints: (points: number) => void;
  setSaleDate: (saleDate: string) => void;
  replaceCart: (
    items: import('@/types').CartItem[],
    customerId: string | null,
    saleDate?: string,
  ) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartState>()((set) => ({
  items: [],
  customerId: null,
  loyaltyPointsRedeemed: 0,
  saleDate: todayDateString(),
  addItem: (item) =>
    set((state) => {
      const key = cartLineKey(item.productId, item.sellUom);
      const existing = state.items.find(
        (i) => cartLineKey(i.productId, i.sellUom) === key,
      );
      if (existing) {
        return {
          items: state.items.map((i) =>
            cartLineKey(i.productId, i.sellUom) === key
              ? { ...i, quantity: i.quantity + item.quantity }
              : i,
          ),
        };
      }
      return { items: [...state.items, item] };
    }),
  removeItem: (productId, sellUom) =>
    set((state) => ({
      items: state.items.filter(
        (i) => cartLineKey(i.productId, i.sellUom) !== cartLineKey(productId, sellUom),
      ),
    })),
  updateQuantity: (productId, quantity, sellUom) =>
    set((state) => ({
      items:
        quantity <= 0
          ? state.items.filter(
              (i) => cartLineKey(i.productId, i.sellUom) !== cartLineKey(productId, sellUom),
            )
          : state.items.map((i) =>
              cartLineKey(i.productId, i.sellUom) === cartLineKey(productId, sellUom)
                ? { ...i, quantity }
                : i,
            ),
    })),
  updateDiscount: (productId, discount) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.productId === productId ? { ...i, discount } : i,
      ),
    })),
  setCustomer: (customerId) => set({ customerId }),
  setLoyaltyPoints: (loyaltyPointsRedeemed) => set({ loyaltyPointsRedeemed }),
  setSaleDate: (saleDate) => set({ saleDate }),
  replaceCart: (items, customerId, saleDate) =>
    set({
      items,
      customerId,
      ...(saleDate !== undefined ? { saleDate } : {}),
    }),
  clearCart: () =>
    set({
      items: [],
      customerId: null,
      loyaltyPointsRedeemed: 0,
      saleDate: todayDateString(),
    }),
}));
