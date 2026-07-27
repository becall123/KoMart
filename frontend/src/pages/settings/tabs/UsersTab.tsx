import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
  Alert,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import BlockIcon from '@mui/icons-material/Block';
import { SettingsSectionHeader } from '@/components/common/SettingsSectionHeader';
import { useUsers, useCreateUser, useUpdateUser, useDeactivateUser } from '@/hooks/useUsers';
import { useFormatDate } from '@/hooks/useFormatDate';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { UserRole, UserListItem } from '@/types';

const ROLE_COLORS: Record<UserRole, 'error' | 'warning' | 'default'> = {
  admin: 'error',
  manager: 'warning',
  cashier: 'default',
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  cashier: 'Cashier',
};

const roles: UserRole[] = ['admin', 'manager', 'cashier'];

interface UserFormState {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

const emptyForm: UserFormState = { name: '', email: '', password: '', role: 'cashier' };

export function UsersTab() {
  const formatDate = useFormatDate();
  const { data: users = [], isLoading, isError, error: loadError } = useUsers();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deactivateMutation = useDeactivateUser();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserListItem | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const [editForm, setEditForm] = useState<{ name: string; role: UserRole; isActive: boolean; password: string }>({
    name: '', role: 'cashier', isActive: true, password: '',
  });
  const [error, setError] = useState('');
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const openEdit = (user: UserListItem) => {
    setEditTarget(user);
    setEditForm({ name: user.name, role: user.role, isActive: user.isActive, password: '' });
    setError('');
  };

  const handleCreate = async () => {
    setError('');
    try {
      await createMutation.mutateAsync(form);
      showSuccess('User created.');
      setAddOpen(false);
      setForm(emptyForm);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleUpdate = async () => {
    if (!editTarget) return;
    setError('');
    try {
      await updateMutation.mutateAsync({
        id: editTarget.id,
        name: editForm.name,
        role: editForm.role,
        isActive: editForm.isActive,
        ...(editForm.password ? { password: editForm.password } : {}),
      });
      showSuccess(editForm.password ? 'Password changed.' : 'User updated.');
      setEditTarget(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    try {
      await deactivateMutation.mutateAsync(deactivateId);
      showSuccess('User deactivated.');
      setDeactivateId(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <Box>
      <SettingsSectionHeader
        title="User Management"
        description="Create and manage staff accounts and roles."
        action={(
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setAddOpen(true); setForm(emptyForm); setError(''); }}
          >
            Add User
          </Button>
        )}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {getErrorMessage(loadError)}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary">Loading...</Typography>
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary">No users found.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id} sx={{ opacity: user.isActive ? 1 : 0.5 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{user.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{user.email}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={ROLE_LABELS[user.role]}
                      color={ROLE_COLORS[user.role]}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={user.isActive ? 'Active' : 'Inactive'}
                      color={user.isActive ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{formatDate(user.createdAt)}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(user)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {user.isActive && (
                        <Tooltip title="Deactivate">
                          <IconButton size="small" color="error" onClick={() => setDeactivateId(user.id)}>
                            <BlockIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add User Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add User</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2, mt: 1 }}>{error}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={12}>
              <TextField
                label="Full Name"
                fullWidth
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                label="Email"
                type="email"
                fullWidth
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                label="Temporary Password"
                type="password"
                fullWidth
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </Grid>
            <Grid size={12}>
              <FormControl fullWidth>
                <InputLabel>Role</InputLabel>
                <Select
                  label="Role"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                >
                  {roles.map((r) => (
                    <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            loading={createMutation.isPending}
            onClick={handleCreate}
          >
            Create User
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit User — {editTarget?.name}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2, mt: 1 }}>{error}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={12}>
              <TextField
                label="Full Name"
                fullWidth
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Grid>
            <Grid size={12}>
              <FormControl fullWidth>
                <InputLabel>Role</InputLabel>
                <Select
                  label="Role"
                  value={editForm.role}
                  onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                >
                  {roles.map((r) => (
                    <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={12}>
              <TextField
                label="New Password (leave blank to keep current)"
                type="password"
                fullWidth
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              />
            </Grid>
            <Grid size={12}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={editForm.isActive ? 'active' : 'inactive'}
                  onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.value === 'active' }))}
                >
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="inactive">Inactive</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            loading={updateMutation.isPending}
            onClick={handleUpdate}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deactivate Confirm Dialog */}
      <Dialog open={!!deactivateId} onClose={() => setDeactivateId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Deactivate User</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to deactivate this user? They will no longer be able to log in.</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeactivateId(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            loading={deactivateMutation.isPending}
            onClick={handleDeactivate}
          >
            Deactivate
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
