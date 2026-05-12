import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BusinessProductsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/business/products");

  const projects = await db.deliveryOrder
    .findMany({
      where: { createdById: session.user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        productCategory: true,
        updatedAt: true,
      },
    })
    .catch(() => [] as Array<{
      id: string;
      title: string;
      status: string;
      productCategory: string;
      updatedAt: Date;
    }>);

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Products</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            All ad videos you've created, grouped by product line.
          </p>
        </div>
        <Link
          href="/business/create-ad-video"
          className="inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
        >
          New ad video
        </Link>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-card/30 p-12 text-center">
          <h2 className="text-lg font-semibold tracking-tight">
            No products yet
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Start with the unified creative input. Aivora will group your videos by product automatically.
          </p>
          <Link
            href="/business/create-ad-video"
            className="mt-6 inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Create your first video
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-white/10 bg-card p-5 hover:bg-card/80 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold tracking-tight">
                    {p.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.status} · {p.productCategory}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                  {new Date(p.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
