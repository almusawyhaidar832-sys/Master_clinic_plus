import { cn } from "@/lib/utils";
import { Inbox } from "lucide-react";
import { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T, index: number) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  emptyMessage?: string;
  highlightDebt?: (row: T) => boolean;
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  emptyMessage = "لا توجد بيانات",
  highlightDebt,
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-border bg-surface-card py-14 text-center text-slate-muted">
        <Inbox className="h-8 w-8 text-slate-muted/50" strokeWidth={1.5} />
        <span className="text-sm">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-border bg-surface-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-border bg-surface">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3.5 text-right text-xs font-bold uppercase tracking-wide text-slate-muted",
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => {
              const hasDebt = highlightDebt?.(row);
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-slate-border/60 transition-colors last:border-b-0 hover:bg-primary-50/50",
                    index % 2 === 0 ? "bg-surface-card" : "bg-surface/50",
                    hasDebt && "bg-debt/40 hover:bg-debt/60"
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-right text-slate-text",
                        hasDebt && col.key === "remaining_debt" && "font-semibold text-debt-text",
                        col.className
                      )}
                    >
                      {col.render(row, index)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
