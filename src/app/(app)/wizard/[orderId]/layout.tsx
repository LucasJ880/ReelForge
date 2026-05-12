import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWizardPage } from "@/lib/api-auth";
import { getClientProject } from "@/lib/services/client-project-service";
import { WizardBriefSummary } from "@/components/wizard/wizard-brief-summary";
import { WizardStepIndicator } from "@/components/wizard/wizard-step-indicator";
import { buildWizardSteps } from "@/components/wizard/wizard-steps";

export default async function WizardOrderLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orderId: string }>;
}) {
  await requireWizardPage();
  const { orderId } = await params;
  const project = await getClientProject(orderId);
  if (!project) redirect("/wizard");

  const flags = await loadProgressFlags(orderId);
  const steps = buildWizardSteps(orderId, flags);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight">
            {project.order.title}
          </h1>
          {/* currentStep 由 client 端 indicator 用 usePathname 自动推断 */}
          <WizardStepIndicator steps={steps} />
        </div>
        <WizardBriefSummary
          brief={project.brief}
          selectedCardTitle={project.order.selectedCreativeCard?.title}
          status={project.order.status}
        />
      </div>
      {children}
    </div>
  );
}

async function loadProgressFlags(orderId: string) {
  const order = await db.deliveryOrder.findUnique({
    where: { id: orderId },
    select: {
      selectedCreativeCardId: true,
      rounds: {
        select: {
          angles: {
            select: {
              videoBrief: {
                select: {
                  scripts: {
                    where: { isCurrent: true },
                    select: {
                      id: true,
                      scenePlans: { select: { id: true } },
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
        orderBy: { roundIndex: "desc" },
        take: 1,
      },
      rawAssets: { select: { id: true }, take: 1 },
      wizardRenderJobs: { select: { id: true }, take: 1 },
    },
  });
  if (!order) {
    return {
      cardSelected: false,
      scriptReady: false,
      storyboardReady: false,
      assetsReady: false,
      renderReady: false,
    };
  }
  const script = order.rounds[0]?.angles?.[0]?.videoBrief?.scripts?.[0];
  return {
    cardSelected: !!order.selectedCreativeCardId,
    scriptReady: !!script,
    storyboardReady: (script?.scenePlans?.length ?? 0) > 0,
    assetsReady: order.rawAssets.length > 0,
    renderReady: order.wizardRenderJobs.length > 0,
  };
}
