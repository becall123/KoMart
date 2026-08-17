import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  Paper,
  Typography,
  CircularProgress,
} from '@mui/material';
import type { ReactNode } from 'react';

export interface Column<T> {
  id: string;
  label: string;
  minWidth?: number;
  align?: 'left' | 'right' | 'center';
  render?: (row: T, index: number) => ReactNode;
  accessor?: keyof T;
  sortable?: boolean;
  sortKey?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  emptyMessage?: string;
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (sortKey: string) => void;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  page = 0,
  pageSize = 25,
  total,
  onPageChange,
  onPageSizeChange,
  emptyMessage = 'No data found',
  getRowId,
  onRowClick,
  onRowDoubleClick,
  sortBy,
  sortOrder = 'asc',
  onSort,
}: DataTableProps<T>) {
  return (
    <Paper variant="outlined" sx={{ width: '100%', overflow: 'hidden', border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <TableContainer sx={{ maxHeight: 600, borderTop: 1, borderColor: 'divider' }}>
        <Table stickyHeader size="small" sx={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  align={col.align ?? 'left'}
                  sortDirection={col.sortable && sortBy === col.sortKey ? sortOrder : false}
                  sx={{ minWidth: col.minWidth, fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  {col.sortable && col.sortKey && onSort ? (
                    <TableSortLabel
                      active={sortBy === col.sortKey}
                      direction={sortBy === col.sortKey ? sortOrder : 'asc'}
                      onClick={() => onSort(col.sortKey!)}
                    >
                      {col.label}
                    </TableSortLabel>
                  ) : (
                    col.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={32} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}>
                  <Typography color="text.secondary">{emptyMessage}</Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, rowIndex) => (
                <TableRow
                  key={getRowId(row)}
                  hover
                  onClick={() => onRowClick?.(row)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  sx={{
                    cursor: onRowClick ? 'pointer' : 'default',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:nth-of-type(even)': { backgroundColor: 'rgba(0, 0, 0, 0.02)' },
                  }}
                >
                  {columns.map((col) => (
                    <TableCell key={col.id} align={col.align ?? 'left'} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                      {col.render
                        ? col.render(row, rowIndex + page * pageSize)
                        : col.accessor
                          ? String(row[col.accessor] ?? '')
                          : null}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {onPageChange && (
        <TablePagination
          component="div"
          count={total ?? rows.length}
          page={page}
          onPageChange={(_, p) => onPageChange(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => {
            onPageSizeChange?.(Number(e.target.value));
            onPageChange?.(0);
          }}
          rowsPerPageOptions={[10, 25, 50]}
        />
      )}
    </Paper>
  );
}
