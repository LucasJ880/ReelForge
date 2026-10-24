/**
 * 1025 验收：给验收工作区开通询盘页、建一条渠道追踪链接（幂等）。
 * 走的是超管开通同一个服务函数（updateWorkspaceLeadPageAdmin），不绕过校验。
 *
 * 用法：
 *   npx tsx --env-file=.env.local scripts/e2e-1025/acceptance-growth-setup.ts [--email=...] [--slug=...] [--disable]
 */
import { db } from "../../src/lib/db";
import { updateWorkspaceLeadPageAdmin } from "../../src/lib/services/lead-service";
import { generateTrackedLinkCode } from "../../src/lib/services/tracked-link-service";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"] as const;
  }),
);
const email = (args.get("email") ?? "lucas+e2e1025@sunnyshutter.ca").toLowerCase();
const slug = args.get("slug") ?? "e2e-1025-acceptance";
const LABEL = "1025 验收 · IG 主页链接";

async function main() {
  const owner = await db.adminUser.findUnique({
    where: { email },
    select: { id: true, workspace: { select: { id: true } } },
  });
  if (!owner?.workspace) throw new Error("验收账号或工作区不存在，先跑 acceptance-account.ts");
  const workspaceId = owner.workspace.id;

  if (args.get("disable") === "true") {
    await updateWorkspaceLeadPageAdmin(workspaceId, { enabled: false, slug, allowedHosts: [] });
    await db.trackedLink.updateMany({ where: { workspaceId, archivedAt: null }, data: { archivedAt: new Date() } });
    console.log(JSON.stringify({ workspaceId, leadPage: "disabled", trackedLinks: "archived" }));
    return;
  }

  const page = await updateWorkspaceLeadPageAdmin(workspaceId, { enabled: true, slug, allowedHosts: [] });
  const existing = await db.trackedLink.findFirst({
    where: { workspaceId, label: LABEL, archivedAt: null },
    select: { code: true },
  });
  const link =
    existing ??
    (await db.trackedLink.create({
      data: { workspaceId, code: generateTrackedLinkCode(), label: LABEL, channel: "ig_bio" },
      select: { code: true },
    }));
  console.log(JSON.stringify({ workspaceId, slug: page.publicSlug, enabled: page.leadPageEnabled, trackedCode: link.code }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
