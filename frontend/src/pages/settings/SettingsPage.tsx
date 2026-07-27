import { useState, useEffect } from 'react';
import { Box, Tab, Tabs, Alert } from '@mui/material';
import StoreIcon from '@mui/icons-material/Store';
import PeopleIcon from '@mui/icons-material/People';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import StraightenIcon from '@mui/icons-material/Straighten';
import PaymentsIcon from '@mui/icons-material/Payments';
import HistoryIcon from '@mui/icons-material/History';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { useAuthStore } from '@/store';
import { isAdmin, isAdminOrManager } from '@/utils';
import { StoreInfoTab } from './tabs/StoreInfoTab';
import { UsersTab } from './tabs/UsersTab';
import { CategoriesTab } from './tabs/CategoriesTab';
import { UomsTab } from './tabs/UomsTab';
import { ExpenseCategoriesTab } from './tabs/ExpenseCategoriesTab';
import { AuditLogsTab } from './tabs/AuditLogsTab';
import { DiscountsTab } from './tabs/DiscountsTab';

type TabKey = 'store' | 'users' | 'categories' | 'uoms' | 'expense-categories' | 'discounts' | 'audit';

const TAB_ORDER: TabKey[] = [
  'store',
  'users',
  'categories',
  'uoms',
  'expense-categories',
  'discounts',
  'audit',
];

export function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const adminOnly = isAdmin(user?.role);
  const managerAccess = isAdminOrManager(user?.role);

  const initialTab = (tab as TabKey) ?? 'store';
  const [activeTab, setActiveTab] = useState<TabKey>(
    TAB_ORDER.includes(initialTab as TabKey) ? (initialTab as TabKey) : 'store',
  );

  useEffect(() => {
    if (tab && TAB_ORDER.includes(tab as TabKey)) {
      setActiveTab(tab as TabKey);
    }
  }, [tab]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: TabKey) => {
    setActiveTab(newValue);
    navigate(`/settings/${newValue}`, { replace: true });
  };

  return (
    <Box>
      <PageHeader title="Settings" subtitle="Store configuration, users, categories, UOM, expenses, discounts, and audit logs" />

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab
            value="store"
            label="Store Info"
            icon={<StoreIcon />}
            iconPosition="start"
          />
          {adminOnly && (
            <Tab
              value="users"
              label="Users"
              icon={<PeopleIcon />}
              iconPosition="start"
            />
          )}
          <Tab
            value="categories"
            label="Categories"
            icon={<LocalOfferIcon />}
            iconPosition="start"
          />
          <Tab
            value="uoms"
            label="UOM"
            icon={<StraightenIcon />}
            iconPosition="start"
          />
          <Tab
            value="expense-categories"
            label="Expense Categories"
            icon={<PaymentsIcon />}
            iconPosition="start"
          />
          {managerAccess && (
            <Tab
              value="discounts"
              label="Discounts"
              icon={<LocalOfferOutlinedIcon />}
              iconPosition="start"
            />
          )}
          {managerAccess && (
            <Tab
              value="audit"
              label="Audit Logs"
              icon={<HistoryIcon />}
              iconPosition="start"
            />
          )}
        </Tabs>
      </Box>

      {activeTab === 'store' && <StoreInfoTab />}
      {activeTab === 'users' && (
        adminOnly ? (
          <UsersTab />
        ) : (
          <Alert severity="error">Admin access required to manage users.</Alert>
        )
      )}
      {activeTab === 'categories' && <CategoriesTab />}
      {activeTab === 'uoms' && <UomsTab />}
      {activeTab === 'expense-categories' && <ExpenseCategoriesTab />}
      {activeTab === 'discounts' && (
        managerAccess ? (
          <DiscountsTab />
        ) : (
          <Alert severity="error">Manager or admin access required to manage discounts.</Alert>
        )
      )}
      {activeTab === 'audit' && (
        managerAccess ? (
          <AuditLogsTab />
        ) : (
          <Alert severity="error">Manager or admin access required to view audit logs.</Alert>
        )
      )}
    </Box>
  );
}
