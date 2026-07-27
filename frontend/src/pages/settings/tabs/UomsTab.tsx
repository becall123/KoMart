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
import { useUoms, useCreateUom, useUpdateUom, useDeleteUom } from '@/hooks/useUoms';
import { useAuthStore } from '@/store';
import { isAdmin } from '@/utils';
import { getErrorMessage } from '@/services/apiClient';
import { showSuccess } from '@/utils/toast';
import type { Uom } from '@/types';

export function UomsTab() {
  const user = useAuthStore((s) => s.user);
  const canDelete = isAdmin(user?.role);

  const { data: uoms = [], isLoading } = useUoms(true);
  const createMutation = useCreateUom();
  const updateMutation = useUpdateUom();
  const deleteMutation = useDeleteUom();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Uom | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [error, setError] = useState('');

  const openEdit = (uom: Uom) => {
    setEditTarget(uom);
    setEditCode(uom.code);
    setEditLabel(uom.label);
    setEditDesc(uom.description);
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
      showSuccess('UOM created.');
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
        code: editCode.trim().toLowerCase(),
        label: editLabel.trim(),
        description: editDesc.trim(),
      });
      showSuccess('UOM updated.');
      setEditTarget(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleToggleActive = async (uom: Uom) => {
    setError('');
    try {
      await updateMutation.mutateAsync({ id: uom.id, isActive: !uom.isActive });
      showSuccess(uom.isActive ? 'UOM deactivated.' : 'UOM activated.');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleDeactivate = async (id: string) => {
    setError('');
    try {
      await deleteMutation.mutateAsync(id);
      showSuccess('UOM deleted.');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <Box>
      <SettingsSectionHeader
        title="Units of Measure"
        description="Manage units used on products (e.g. pcs, pack, kg). The code is stored on product records."
        action={(
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setAddOpen(true); setNewCode(''); setNewLabel(''); setNewDesc(''); setError(''); }}
          >
            Add UOM
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
              {uoms.map((uom) => (
                <TableRow key={uom.id} sx={{ opacity: uom.isActive ? 1 : 0.5 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                      {uom.code}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{uom.label}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {uom.description || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={uom.isActive ? 'Active' : 'Inactive'}
                      color={uom.isActive ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(uom)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={uom.isActive ? 'Deactivate' : 'Activate'}>
                        <IconButton
                          size="small"
                          color={uom.isActive ? 'warning' : 'success'}
                          onClick={() => handleToggleActive(uom)}
                        >
                          {uom.isActive ? <BlockIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                      {canDelete && (
                        <Tooltip title="Permanently deactivate (admin)">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeactivate(uom.id)}
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

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Unit of Measure</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2, mt: 1 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Code"
              fullWidth
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              helperText="Short code used in products (e.g. pcs, pack, kg)"
              autoFocus
            />
            <TextField
              label="Label"
              fullWidth
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              helperText="Display name (e.g. Pieces (pcs))"
            />
            <TextField
              label="Description (optional)"
              fullWidth
              multiline
              rows={2}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            loading={createMutation.isPending}
            onClick={handleCreate}
            disabled={!newCode.trim() || !newLabel.trim()}
          >
            Add UOM
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit UOM — {editTarget?.code}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2, mt: 1 }}>{error}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Code"
              fullWidth
              value={editCode}
              onChange={(e) => setEditCode(e.target.value)}
            />
            <TextField
              label="Label"
              fullWidth
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
            />
            <TextField
              label="Description (optional)"
              fullWidth
              multiline
              rows={2}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            loading={updateMutation.isPending}
            onClick={handleUpdate}
            disabled={!editCode.trim() || !editLabel.trim()}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
