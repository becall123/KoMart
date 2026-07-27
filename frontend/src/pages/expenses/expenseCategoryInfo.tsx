import { IconButton, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

export const EXPENSE_CATEGORY_INFO =
  'Category = type of spend (from Settings: rent, utilities, other, etc.).\n' +
  'Setup / Investment = checkbox on, or category is Setup / Investment.\n' +
  'Operating = everything else (total − setup).\n' +
  'Purchase Order is a system category for PO payments.';

export function ExpenseCategoryInfoIcon() {
  return (
    <Tooltip
      title={
        <Typography variant="caption" component="div" sx={{ whiteSpace: 'pre-line' }}>
          {EXPENSE_CATEGORY_INFO}
        </Typography>
      }
    >
      <IconButton size="small" aria-label="About expense categories" sx={{ p: 0.5 }}>
        <InfoOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
