import Link from "next/link";
import { Sparkles, Film } from "lucide-react";

export default function PersonalHomePage() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          What do you want to make today?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Type a prompt, pick a duration, generate. That&apos;s it.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/personal/create-video"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">Create</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            New video
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Text-to-video, image-to-video, or stitch your own clips together.
          </p>
        </Link>

        <Link
          href="/personal/videos"
          className="group rounded-xl border border-white/10 bg-card p-6 hover:border-white/20 hover:bg-card/80 transition-colors"
        >
          <div className="flex items-center gap-3 text-muted-foreground">
            <Film className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">Library</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">
            My videos
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you&apos;ve made.
          </p>
        </Link>
      </section>
    </div>
  );
}
