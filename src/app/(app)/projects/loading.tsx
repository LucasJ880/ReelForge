export default function ProjectsLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-3 w-12 rounded bg-zinc-800" />
          <div className="h-5 w-24 rounded bg-zinc-800" />
        </div>
        <div className="h-10 w-20 rounded-lg bg-zinc-800" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-zinc-800 p-4 space-y-3">
            <div className="flex justify-between">
              <div className="h-4 w-24 rounded bg-zinc-800" />
              <div className="h-4 w-14 rounded-full bg-zinc-900" />
            </div>
            <div className="h-3 w-full rounded bg-zinc-900" />
            <div className="h-3 w-16 rounded bg-zinc-900" />
          </div>
        ))}
      </div>
    </div>
  );
}
