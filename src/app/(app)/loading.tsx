export default function DashboardLoading() {
  return (
    <div className="space-y-10 animate-pulse">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-3 w-20 rounded bg-secondary" />
          <div className="h-6 w-64 rounded bg-secondary" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-24 rounded-lg bg-secondary" />
          <div className="h-10 w-24 rounded-lg bg-secondary" />
        </div>
      </div>
      <div className="flex gap-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="h-7 w-12 rounded bg-secondary" />
            <div className="h-3 w-8 rounded bg-card" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex justify-between">
              <div className="h-4 w-20 rounded bg-secondary" />
              <div className="h-4 w-16 rounded-full bg-card" />
            </div>
            <div className="h-3 w-full rounded bg-card" />
            <div className="h-3 w-16 rounded bg-card" />
          </div>
        ))}
      </div>
    </div>
  );
}
