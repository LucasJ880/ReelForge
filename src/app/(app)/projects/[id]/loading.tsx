export default function ProjectDetailLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="h-3 w-16 rounded bg-zinc-800" />
          <div className="h-4 w-14 rounded-full bg-zinc-900" />
        </div>
        <div className="h-6 w-40 rounded bg-zinc-800" />
        <div className="h-3 w-28 rounded bg-zinc-900 mt-2" />
      </div>
      <div className="flex items-center gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-full bg-zinc-800" />
            <div className="h-3 w-8 rounded bg-zinc-900 hidden sm:block" />
            {i < 3 && <div className="h-px w-6 bg-zinc-800" />}
          </div>
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="h-3 w-16 rounded bg-zinc-800 mb-3" />
          <div className="rounded-2xl bg-zinc-800 aspect-[9/16]" />
        </div>
        <div className="lg:col-span-3 space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="h-3 w-20 rounded bg-zinc-800 mb-2" />
              <div className="h-12 w-full rounded bg-zinc-900" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
