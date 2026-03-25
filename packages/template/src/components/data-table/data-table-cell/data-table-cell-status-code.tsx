import { DataTableCellBadge } from './data-table-cell-badge';

export function DataTableCellStatusCode({
  value,
  color,
}: {
  value: string | number;
  color?: string;
}) {
  return <DataTableCellBadge value={value} color={color} />;
}
