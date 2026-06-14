/** Route transition placeholder — existing utility classes only */
export default function DashboardLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-slate-100" />
      <div className="h-4 w-64 max-w-full rounded bg-slate-100" />
      <div className="h-72 rounded-xl bg-slate-100" />
    </div>
  );
}
