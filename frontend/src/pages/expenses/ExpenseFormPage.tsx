import { useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PageHeader } from '@/components/common/PageHeader';
import { NepaliAwareDatePicker } from '@/components/common/NepaliAwareDatePicker';
import { useCreateExpense, useUpdateExpense, useExpense } from '@/hooks/useExpenses';
import { useExpenseCategoryOptions } from '@/hooks/useExpenseCategories';
import { PAYMENT_METHODS, CURRENCY_SYMBOL } from '@/constants';
import { showApiError, showSuccess } from '@/utils/toast';
import { formatCurrency } from '@/utils';
import { ExpenseCategoryInfoIcon } from './expenseCategoryInfo';

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  amount: z.number({ error: 'Amount is required' }).positive('Amount must be positive'),
  category: z.string().min(1, 'Category is required'),
  date: z.string().min(1, 'Date is required'),
  paidTo: z.string().optional(),
  billNo: z.string().optional(),
  paymentMethod: z.string().optional(),
  isSetupCost: z.boolean(),
  description: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ExpenseFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const { data: existing, isLoading } = useExpense(id ?? '');
  const createMutation = useCreateExpense();
  const updateMutation = useUpdateExpense();
  const categoryOptions = useExpenseCategoryOptions();

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      amount: undefined,
      category: '',
      date: new Date().toISOString().split('T')[0],
      paidTo: '',
      billNo: '',
      paymentMethod: '',
      isSetupCost: false,
      description: '',
    },
  });

  useEffect(() => {
    if (existing) {
      reset({
        title: existing.title,
        amount: existing.amount,
        category: existing.category,
        date: existing.date,
        paidTo: existing.paidTo ?? '',
        billNo: existing.billNo ?? '',
        paymentMethod: existing.paymentMethod ?? '',
        isSetupCost: existing.isSetupCost,
        description: existing.description ?? '',
      });
    }
  }, [existing, reset]);

  const category = watch('category');
  useEffect(() => {
    if (category === 'setup_investment') {
      setValue('isSetupCost', true);
    }
  }, [category, setValue]);

  const onSubmit = (values: FormValues) => {
    const payload = {
      title: values.title,
      amount: values.amount,
      category: values.category,
      date: values.date,
      paidTo: values.paidTo || undefined,
      billNo: values.billNo?.trim() || '',
      paymentMethod: values.paymentMethod || undefined,
      isSetupCost: values.isSetupCost || values.category === 'setup_investment',
      description: values.description || undefined,
    };

    if (isEdit && id) {
      updateMutation.mutate(
        { id, data: payload },
        {
          onSuccess: () => {
            showSuccess('Expense updated.');
            navigate('/expenses');
          },
          onError: (err) => showApiError(err, 'Expense could not be saved.'),
        },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          showSuccess('Expense created.');
          navigate('/expenses');
        },
        onError: (err) => showApiError(err, 'Expense could not be created.'),
      });
    }
  };

  if (isEdit && isLoading) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Typography color="text.secondary">Loading...</Typography>
      </Box>
    );
  }

  if (isEdit && existing?.purchaseOrderId) {
    return (
      <Box>
        <PageHeader
          title="PO-linked Expense"
          breadcrumbs={[
            { label: 'Expenses', path: '/expenses' },
            { label: 'View' },
          ]}
          action={
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/expenses')}>
              Back
            </Button>
          }
        />
        <Alert severity="info" sx={{ mb: 2 }}>
          This expense was created from a purchase order payment and cannot be edited here.
          Delete it from the expenses list to reverse the payment, or open the purchase order to record a new payment.
        </Alert>
        <Paper sx={{ p: 3, maxWidth: 800 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{existing.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {formatCurrency(existing.amount)} · {existing.date}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Bill no.: {existing.billNo?.trim() ? existing.billNo : '—'}
            {existing.paymentMethod ? ` · ${existing.paymentMethod}` : ''}
            {existing.paidTo ? ` · Paid to ${existing.paidTo}` : ''}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => navigate(`/purchase-orders/${existing.purchaseOrderId}`)}
          >
            Open purchase order
          </Button>
        </Paper>
      </Box>
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Box>
      <PageHeader
        title={isEdit ? 'Edit Expense' : 'Add Expense'}
        breadcrumbs={[
          { label: 'Expenses', path: '/expenses' },
          { label: isEdit ? 'Edit' : 'New Expense' },
        ]}
        action={
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/expenses')}>
            Back
          </Button>
        }
      />

      <Paper sx={{ p: 3, maxWidth: 800 }}>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={3}>
            {/* Title */}
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Title"
                fullWidth
                required
                {...register('title')}
                error={!!errors.title}
                helperText={errors.title?.message}
              />
            </Grid>

            {/* Amount + Category */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Amount"
                type="number"
                fullWidth
                required
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">{CURRENCY_SYMBOL}</InputAdornment>
                    ),
                  },
                }}
                {...register('amount', { valueAsNumber: true })}
                error={!!errors.amount}
                helperText={errors.amount?.message}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth required error={!!errors.category}>
                      <InputLabel>Category</InputLabel>
                      <Select label="Category" {...field}>
                        {categoryOptions.map((c) => (
                          <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
                        ))}
                      </Select>
                      {errors.category && (
                        <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                          {errors.category.message}
                        </Typography>
                      )}
                    </FormControl>
                  )}
                />
                <Box sx={{ pt: 1 }}>
                  <ExpenseCategoryInfoIcon />
                </Box>
              </Box>
            </Grid>

            {/* Date + Paid To */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="date"
                control={control}
                render={({ field }) => (
                  <NepaliAwareDatePicker
                    label="Date"
                    value={field.value}
                    onChange={field.onChange}
                    size="small"
                    fullWidth
                    helperText={errors.date?.message}
                  />
                )}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Paid To"
                fullWidth
                placeholder="Vendor or person name"
                {...register('paidTo')}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Bill no."
                fullWidth
                placeholder="Optional vendor bill / invoice number"
                {...register('billNo')}
              />
            </Grid>

            {/* Payment Method + Setup Cost checkbox */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="paymentMethod"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth>
                    <InputLabel>Payment Method</InputLabel>
                    <Select label="Payment Method" {...field}>
                      <MenuItem value="">— None —</MenuItem>
                      {PAYMENT_METHODS.map((m) => (
                        <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }} sx={{ display: 'flex', alignItems: 'center' }}>
              <Controller
                name="isSetupCost"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={<Checkbox checked={field.value} onChange={field.onChange} />}
                    label="Mark as Setup / Initial Investment"
                  />
                )}
              />
            </Grid>

            {/* Description */}
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Description"
                multiline
                rows={3}
                fullWidth
                placeholder="Optional notes about this expense..."
                {...register('description')}
              />
            </Grid>

            {/* Actions */}
            <Grid size={{ xs: 12 }}>
              <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                <Button onClick={() => navigate('/expenses')}>Cancel</Button>
                <Button
                  type="submit"
                  variant="contained"
                  startIcon={<SaveIcon />}
                  loading={isSaving}
                >
                  {isEdit ? 'Save Changes' : 'Add Expense'}
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Box>
      </Paper>
    </Box>
  );
}
