import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { SettingsSectionHeader } from '@/components/common/SettingsSectionHeader';
import {
  useExpenseCategories,
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  useDeleteExpenseCategory,
} from '@/hooks/useExpenseCategories';
import { useAuthStore } from '@/store';
import { isAdmin } from '@/utils';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { ExpenseCategoryItem } from '@/types';

export function ExpenseCategoriesTab() {
  const user = useAuthStore((s) => s.user);
  const canDelete = isAdmin(user?.role);

  const { data: categories = [], isLoading } = useExpenseCategories(true);
  const createMutation = useCreateExpenseCategory();
  const updateMutation = useUpdateExpenseCategory();
  const deleteMutation = useDeleteExpenseCategory();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExpenseCategoryItem | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [error, setError] = useState('');

  const openEdit = (row: ExpenseCategoryItem) => {
    setEditTarget(row);
    setEditCode(row.code);
    setEditLabel(row.label);
    setEditDesc(row.description);
    setError('');
  };

  const handleCreate = async () => {
    if (!newCode.trim() || !newLabel.trim()) return;
    setError('');
    try {
      await createMutation.mutateAsync({
        code: newCode.trim().toLowerCase(),
        label: newLabel.trim(),
        description: newDesc.trim(),
      });
      showSuccess('Expense category created.');
      setAddOpen(false);
      setNewCode('');
      setNewLabel('');
      setNewDesc('');
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
        code: editTarget.isSystem ? undefined : editCode.trim().toLowerCase(),
        label: editLabel.trim(),
        description: editDesc.trim(),
      });
      showSuccess('Expense category updated.');
      setEditTarget(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleToggleActive = async (row: ExpenseCategoryItem) => {
    if (row.isSystem && row.isActive) {
      setError('System expense categories cannot be deactivated.');
      return;
    }
    setError('');
    try {
      await updateMutation.mutateAsync({ id: row.id, isActive: !row.isActive });
      showSuccess(row.isActive ? 'Expense category deactivated.' : 'Expense category activated.');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDeactivate = async (row: ExpenseCategoryItem) => {
    if (row.isSystem) {
      setError('System expense categories cannot be deactivated.');
      return;
    }
    setError('');
    try {
      await deleteMutation.mutateAsync(row.id);
      showSuccess('Expense category deactivated.');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <Box>
      <SettingsSectionHeader
        title="Expense Categories"
        description="Codes used on expenses and reports. Purchase Order and Setup / Investment are system categories."
        action={(
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setAddOpen(true);
              setNewCode('');
              setNewLabel('');
              setNewDesc('');
              setError('');
            }}
          >
            Add Category
          </Button>
        )}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Label</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {categories.map((row) => (
                <TableRow key={row.id} sx={{ opacity: row.isActive ? 1 : 0.5 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                      {row.code}
                    </Typography>
                    {row.isSystem && (
                      <Chip label="System" size="small" sx={{ mt: 0.5 }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.label}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {row.description || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.isActive ? 'Active' : 'Inactive'}
                      color={row.isActive ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(row)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip
                        title={
                          row.isSystem && row.isActive
                            ? 'System categories stay active'
                            : row.isActive
                              ? 'Deactivate'
                              : 'Activate'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            color={row.isActive ? 'warning' : 'success'}
                            disabled={row.isSystem && row.isActive}
                            onClick={() => void handleToggleActive(row)}
                          >
                            {row.isActive
                              ? <BlockIcon fontSize="small" />
                              : <CheckCircleIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      {canDelete && !row.isSystem && (
                        <Tooltip title="Deactivate (admin)">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => void handleDeactivate(row)}
                          >
                            <BlockIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add Expense Category</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Code"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            size="small"
            fullWidth
            helperText="Lowercase code stored on expenses (e.g. transport)"
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <TextField
            label="Label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Description"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleCreate()}
            loading={createMutation.isPending}
            disabled={!newCode.trim() || !newLabel.trim()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit Expense Category</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Code"
            value={editCode}
            onChange={(e) => setEditCode(e.target.value)}
            size="small"
            fullWidth
            disabled={editTarget?.isSystem}
            helperText={editTarget?.isSystem ? 'System category code cannot be changed' : undefined}
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <TextField
            label="Label"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Description"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleUpdate()}
            loading={updateMutation.isPending}
            disabled={!editLabel.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
