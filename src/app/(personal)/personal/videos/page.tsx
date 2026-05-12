import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PersonalVideosPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?from=/personal/videos");

  const orders = await db.deliveryOrder
    .findMany({
      where: {
        createdById: session.user.id,
        productCategory: "unified_input",
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        rounds: {
          take: 1,
          orderBy: { roundIndex: "desc" },
          include: {
            angles: {
              take: 1,
              include: { videoBrief: { select: { persona: true } } },
            },
          },
        },
      },
    })
    .catch(() => []);

  const personalOrders = orders.filter((o) =>
    o.rounds[0]?.angles[0]?.videoBrief?.persona === "PERSONAL",
  );

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">My videos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Everything you've made on Aivora.
          </p>
        </div>
        <Link
          href="/personal/create-video"
          className="inline-flex items-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
        >
          New video
        </Link>
      </header>

      {personalOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-card/30 p-12 text-center">
          <h2 className="text-lg font-semibold tracking-tight">Empty for now</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Generate your first video to fill this space.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {personalOrders.map((o) => (
            <li
              key={o.id}
              className="rounded-lg border border-white/10 bg-card p-5 hover:bg-card/80 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold tracking-tight">
                    {o.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{o.status}</p>
                </div>
                <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                  {new Date(o.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
