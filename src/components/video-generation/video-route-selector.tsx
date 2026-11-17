"use client";

import { useEffect, useState } from "react";
import {
  Box,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Route,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/i18n/useTranslation";
import { cn } from "@/lib/utils";

/// 线路只有 buddy 一条（直连线路 2026-11-17 删除）；这个选择器现在选的是这条线路下的套餐。
export type VideoRouteOverride = "buddy";

export interface ShuyuRouteUiStatus {
  configured: boolean;
  funded: boolean;
  available: boolean;
  reason: string | null;
}

interface VideoRouteUiStatus {
  shuyu: ShuyuRouteUiStatus;
  plans: ShuyuPlanUiOption[];
}

const ROUTE_COPY = {
  "zh-CN": {
    label: "视频生成接口",
    shuyuGroup: "Aivora 生成线路",
    shuyuTitle: "Aivora 视频通道 · Seedance 2.0",
    shuyuDescription: "文生 / 图片参考 · 每镜头 5–15 秒",
    shuyuEstimate: "当前时长预计 {points} 积分/支 · 提交前再次核对",
    available: "已接入",
    checking: "正在检查",
    notConfigured: "尚未配置",
    insufficient: "余额不足",
    unavailable: "暂不可用",
    planGroup: "套餐选择 · 实时价目",
    planDefault: "推荐",
    planCustomer: "线路 {n}",
    planPerVideo: "积分/支",
    planPerSecond: "积分/秒",
    planInfoOnly: "本入口按推荐套餐提交",
    planEmpty: "价目暂不可用,提交时按实时默认套餐",
  },
  "en-US": {
    label: "Video generation interface",
    shuyuGroup: "Aivora generation route",
    shuyuTitle: "Aivora video route · Seedance 2.0",
    shuyuDescription: "Text / image reference · 5–15s per shot",
    shuyuEstimate: "Estimated {points} points/video · checked again before submit",
    available: "Connected",
    checking: "Checking",
    notConfigured: "Not configured",
    insufficient: "No balance",
    unavailable: "Unavailable",
    planGroup: "Plan selection · live pricing",
    planDefault: "Recommended",
    planCustomer: "Route {n}",
    planPerVideo: "points/video",
    planPerSecond: "points/second",
    planInfoOnly: "This entry submits on the recommended plan",
    planEmpty: "Pricing unavailable; the live default plan applies at submit",
  },
} as const;

export interface ShuyuPlanUiOption {
  planId: string;
  displayName: string;
  resolution: "480P" | "720P";
  billingUnit: "generation" | "second";
  unitSalePoints: number;
  isDefault: boolean;
}

export function shuyuPlanPointsPerVideo(
  plan: ShuyuPlanUiOption,
  durationSeconds: number,
): number {
  return plan.billingUnit === "generation"
    ? plan.unitSalePoints
    : plan.unitSalePoints * Math.max(1, Math.ceil(durationSeconds));
}

export function VideoRouteSelector({
  canSelectVideoRoute,
  shuyuStatus = null,
  durationSeconds = 15,
  value,
  disabled,
  onChange,
  onSelectedAvailabilityChange,
  planSelectable = false,
  planValue = null,
  onPlanChange,
  showPlanPoints = true,
}: {
  canSelectVideoRoute: boolean;
  shuyuStatus?: ShuyuRouteUiStatus | null;
  durationSeconds?: number;
  value: VideoRouteOverride;
  disabled: boolean;
  onChange: (value: VideoRouteOverride) => void;
  onSelectedAvailabilityChange?: (available: boolean | null) => void;
  /// true 时套餐可选并回传选择;false 时只展示实时价目(按默认套餐提交)。
  planSelectable?: boolean;
  planValue?: string | null;
  onPlanChange?: (
    planId: string | null,
    pointsPerVideo: number | null,
    plan?: ShuyuPlanUiOption | null,
  ) => void;
  /// false 时套餐只写名称与分辨率、不写供应商积分（客户面：客户的成本是额度里的成片条数）。
  showPlanPoints?: boolean;
}) {
  const { locale } = useTranslation();
  const copy = ROUTE_COPY[locale];
  const [plans, setPlans] = useState<ShuyuPlanUiOption[]>([]);
  const [resolvedShuyuStatus, setResolvedShuyuStatus] = useState(shuyuStatus);
  const [statusLoadFailed, setStatusLoadFailed] = useState(false);

  useEffect(() => {
    if (!canSelectVideoRoute) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setResolvedShuyuStatus(null);
      setStatusLoadFailed(false);
    });
    void fetch(`/api/video-generation/routes?duration=${durationSeconds}`, {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("route status unavailable");
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        const status = readVideoRouteStatus(payload);
        if (!status) throw new Error("invalid route status");
        setResolvedShuyuStatus(status.shuyu);
        setPlans(status.plans);
        setStatusLoadFailed(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatusLoadFailed(true);
      });
    return () => controller.abort();
  }, [canSelectVideoRoute, durationSeconds]);

  useEffect(() => {
    if (!onSelectedAvailabilityChange) return;
    onSelectedAvailabilityChange(
      statusLoadFailed ? false : resolvedShuyuStatus?.available ?? null,
    );
  }, [
    onSelectedAvailabilityChange,
    resolvedShuyuStatus?.available,
    statusLoadFailed,
  ]);

  /// 套餐有效性与报价回传:清单刷新后,已选套餐若已下架则回落默认并上报;
  /// 清单还没拿到时回传 null。
  const selectedPlan =
    plans.length > 0
      ? (plans.find((plan) => plan.planId === planValue) ?? plans[0])
      : null;
  useEffect(() => {
    if (!onPlanChange) return;
    if (plans.length === 0) {
      onPlanChange(null, null, null);
      return;
    }
    const effective =
      plans.find((plan) => plan.planId === planValue) ?? plans[0];
    onPlanChange(
      effective.planId,
      shuyuPlanPointsPerVideo(effective, durationSeconds),
      effective,
    );
  }, [onPlanChange, planValue, durationSeconds, plans]);

  if (!canSelectVideoRoute) return null;

  const shuyuLabel = resolvedShuyuStatus === null
    ? statusLoadFailed ? copy.unavailable : copy.checking
    : resolvedShuyuStatus.available
      ? copy.available
      : !resolvedShuyuStatus.configured
        ? copy.notConfigured
        : !resolvedShuyuStatus.funded || resolvedShuyuStatus.reason === "insufficient_balance"
          ? copy.insufficient
          : copy.unavailable;
  /// 报价随 /prices 实时解析;拿不到就不编数字,退回无价格描述。客户面不写供应商积分。
  const shuyuDescription = selectedPlan && showPlanPoints
    ? `${copy.shuyuDescription} · ${copy.shuyuEstimate.replace(
        "{points}",
        shuyuPlanPointsPerVideo(selectedPlan, durationSeconds).toLocaleString(),
      )}`
    : copy.shuyuDescription;
  const selectedTitle = copy.shuyuTitle;
  const selectedDescription = `${shuyuDescription} · ${shuyuLabel}`;

  return (
    <div data-testid="video-route-selector" className="min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={`${copy.label}: ${selectedTitle}. ${selectedDescription}`}
          className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-(--radius-sm) text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Route className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-foreground">{selectedTitle}</span>
            <span className="block truncate text-meta font-normal text-muted-foreground">{selectedDescription}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="w-[min(34rem,calc(100vw-2rem))] p-2"
        >
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={() => onChange("buddy")}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>{copy.shuyuGroup}</DropdownMenuLabel>
              <RouteRadioItem
                value="buddy"
                icon={Box}
                title={copy.shuyuTitle}
                description={shuyuDescription}
                status={shuyuLabel}
                active={value === "buddy"}
                warning={!resolvedShuyuStatus?.available}
              />
            </DropdownMenuGroup>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{copy.planGroup}</DropdownMenuLabel>
            {plans.length === 0 ? (
              <DropdownMenuItem
                aria-disabled="true"
                closeOnClick={false}
                onClick={(event) => event.preventDefault()}
                className="cursor-default items-start py-2.5 opacity-60"
              >
                <CircleAlert className="mt-0.5 size-4" aria-hidden />
                <span className="text-meta text-muted-foreground">{copy.planEmpty}</span>
              </DropdownMenuItem>
            ) : (
              plans.map((plan, planIndex) => {
                const selected = selectedPlan?.planId === plan.planId;
                const unitLabel = plan.billingUnit === "generation"
                  ? copy.planPerVideo
                  : copy.planPerSecond;
                return (
                  <DropdownMenuItem
                    key={plan.planId}
                    closeOnClick={false}
                    aria-disabled={planSelectable ? undefined : "true"}
                    onClick={(event) => {
                      event.preventDefault();
                      if (planSelectable && onPlanChange) {
                        onPlanChange(
                          plan.planId,
                          shuyuPlanPointsPerVideo(plan, durationSeconds),
                          plan,
                        );
                      }
                    }}
                    className={cn(
                      "items-start py-2.5",
                      planSelectable ? "cursor-pointer" : "cursor-default",
                      !selected && "opacity-70",
                    )}
                  >
                    <CheckCircle2
                      className={cn(
                        "mt-0.5 size-4",
                        selected
                          ? "text-success"
                          : "text-muted-foreground opacity-40",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-foreground">
                        {/* 供应商套餐原名（「视频-Seedance2.0-720P-推荐1」）只给内部角色看 */}
                        {showPlanPoints ? plan.displayName : copy.planCustomer.replace("{n}", String(planIndex + 1))}
                        {plan.isDefault ? ` · ${copy.planDefault}` : ""}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-meta tabular-nums text-muted-foreground">
                        {plan.resolution}
                        {showPlanPoints ? ` · ${plan.unitSalePoints.toLocaleString()} ${unitLabel}` : ""}
                        {showPlanPoints && plan.billingUnit === "second"
                          ? ` · ≈${shuyuPlanPointsPerVideo(plan, durationSeconds).toLocaleString()} ${copy.planPerVideo}`
                          : ""}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })
            )}
            {!planSelectable && plans.length > 0 ? (
              <p className="px-2 pb-1 pt-1 text-meta text-muted-foreground">{copy.planInfoOnly}</p>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function readVideoRouteStatus(payload: unknown): VideoRouteUiStatus | null {
  if (
    !isRecord(payload)
    || typeof payload.defaultRouteId !== "string"
    || !Array.isArray(payload.routes)
  ) return null;
  const route = payload.routes.find(
    (candidate) => isRecord(candidate) && candidate.id === "buddy",
  );
  if (
    !isRecord(route)
    || typeof route.configured !== "boolean"
    || typeof route.funded !== "boolean"
    || typeof route.available !== "boolean"
    || !(typeof route.unavailableReason === "string" || route.unavailableReason === null)
  ) {
    return null;
  }
  return {
    shuyu: {
      configured: route.configured,
      funded: route.funded,
      available: route.available,
      reason: route.unavailableReason,
    },
    plans: readShuyuPlanOptions(route.plans),
  };
}

/// plans 是 0803 新增字段;旧部署/异常 payload 缺失时容错为空数组,
/// UI 落到「按实时默认套餐提交」的信息态,不阻塞线路选择。
function readShuyuPlanOptions(value: unknown): ShuyuPlanUiOption[] {
  if (!Array.isArray(value)) return [];
  const options: ShuyuPlanUiOption[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate)
      || typeof candidate.planId !== "string"
      || typeof candidate.displayName !== "string"
      || (candidate.resolution !== "480P" && candidate.resolution !== "720P")
      || (candidate.billingUnit !== "generation" && candidate.billingUnit !== "second")
      || typeof candidate.unitSalePoints !== "number"
      || typeof candidate.isDefault !== "boolean"
    ) {
      continue;
    }
    options.push({
      planId: candidate.planId,
      displayName: candidate.displayName,
      resolution: candidate.resolution,
      billingUnit: candidate.billingUnit,
      unitSalePoints: candidate.unitSalePoints,
      isDefault: candidate.isDefault,
    });
  }
  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function RouteRadioItem({
  value,
  icon: Icon,
  title,
  description,
  status,
  active,
  warning = false,
}: {
  value: VideoRouteOverride;
  icon: typeof Box;
  title: string;
  description: string;
  status: string;
  active: boolean;
  warning?: boolean;
}) {
  return (
    <DropdownMenuRadioItem
      value={value}
      closeOnClick
      className={cn(
        "cursor-pointer items-start py-3 pr-9",
        active && "bg-accent-soft",
      )}
    >
      <Icon className="mt-0.5 size-4" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate font-medium text-foreground">{title}</span>
          <span className={cn(
            "shrink-0 rounded-(--radius-sm) border px-2 py-0.5 font-mono text-[10px]",
            warning
              ? "border-warning/40 text-warning"
              : "border-success/40 text-success",
          )}>
            {status}
          </span>
        </span>
        <span className="mt-1 block text-meta font-normal text-muted-foreground">{description}</span>
      </span>
      {active ? <CheckCircle2 className="sr-only" aria-hidden /> : null}
    </DropdownMenuRadioItem>
  );
}
