import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from './DataTable';

describe('DataTable', () => {
  it('renders serial numbers and fires double-click handlers', () => {
    const rows = [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }];
    const columns: Column<{ id: string; name: string }>[] = [
      { id: 'serial', label: 'S.N', render: (_, index) => String(index + 1) },
      { id: 'name', label: 'Name', accessor: 'name' },
    ];

    const onRowDoubleClick = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
      root.render(
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          onRowDoubleClick={onRowDoubleClick}
        />,
      );
    });

    const firstRow = container.querySelectorAll('tbody tr')[0] as HTMLTableRowElement;
    act(() => {
      firstRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(onRowDoubleClick).toHaveBeenCalledWith(rows[0]);
    expect(container.textContent).toContain('S.N');
    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('Alpha');

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
