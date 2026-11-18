import { TableCell, TableRow } from "@pas/ui/components/table";

export function SkeletonRows({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return Array.from({ length: rows }, (_, i) => (
    <TableRow key={i}>
      <TableCell colSpan={columns}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      </TableCell>
    </TableRow>
  ));
}
