"use client";

import { useEffect, useState } from "react";
import {
  Box,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Route,
  Server,
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

export type VideoRouteOverride =
  | ""
  | "byteplus_international"
  | "volcengine_cn_legacy"
  | "buddy";

export interface ShuyuRouteUiStatus {
  configured: boolean;
  funded: boolean;
  available: boolean;
  reason: string | null;
}

interface VideoRouteUiStatus {
  directAvailable: boolean;
  directRoutes: Partial<Record<Exclude<VideoRouteOverride, "" | "buddy">, boolean>>;
  shuyu: ShuyuRouteUiStatus;
}

export function parseVideoRouteOverride(value: string): VideoRouteOverride {
  return value === "byteplus_international"
    || value === "volcengine_cn_legacy"
    || value === "buddy"
    ? value
    : "";
}

const ROUTE_COPY = {
  "zh-CN": {
    label: "视频生成接口",
    directTitle: "火山官方接口 · Seedance 2.0",
    directDescription: "当前生产默认线路 · 失败按平台规则处理",
    shuyuGroup: "Shuyu 已开放 API 线路",
    shuyuTitle: "Shuyu 合作接口 · Seedance 2.0 · 720P",
    shuyuDescription: "文生 / 图片参考 · 每镜头 5–15 秒 · 900 积分/支",
    shuyuEstimate: "当前时长预计 {points} 积分/支 · 提交前再次核对",
    available: "已接入",
    checking: "正在检查",
    notConfigured: "尚未配置",
    insufficient: "余额不足",
    unavailable: "暂不可用",
    workspaceGroup: "Shuyu 工作台其它 Seedance 线路 · 公开 API 未开放",
    workspaceOnly: "工作台可见，当前 API Key 暂不能调用",
    workspaceRoutes: [
      "Seedance 2.0 · 480P 推荐线路 1 / 2",
      "Seedance 2.0 · 1080P / 4K 推荐线路",
      "Seedance 2.0 · 720P 按条 / 最多 4 图线路",
    ],
    internalGroup: "内部诊断线路",
    byteplus: "BytePlus 国际 · Seedance 2.0",
    volcengine: "火山北京 · Seedance 2.0（显式锁定）",
  },
  "en-US": {
    label: "Video generation interface",
    directTitle: "Volcengine official · Seedance 2.0",
    directDescription: "Current production default · platform recovery rules apply",
    shuyuGroup: "Shuyu public API route",
    shuyuTitle: "Shuyu partner API · Seedance 2.0 · 720P",
    shuyuDescription: "Text / image reference · 5–15s per shot · 900 points/video",
    shuyuEstimate: "Estimated {points} points/video · checked again before submit",
    available: "Connected",
    checking: "Checking",
    notConfigured: "Not configured",
    insufficient: "No balance",
    unavailable: "Unavailable",
    workspaceGroup: "Other Shuyu Seedance routes · not exposed by the public API",
    workspaceOnly: "Visible in the partner workbench, unavailable to this API key",
    workspaceRoutes: [
      "Seedance 2.0 · 480P recommended routes 1 / 2",
      "Seedance 2.0 · 1080P / 4K recommended routes",
      "Seedance 2.0 · 720P per-job / up-to-4-image routes",
    ],
    internalGroup: "Internal diagnostic routes",
    byteplus: "BytePlus international · Seedance 2.0",
    volcengine: "Volcengine Beijing · Seedance 2.0 (explicit)",
  },
} as const;

export function VideoRouteSelector({
  canSelectVideoRoute,
  showInternalRoutes = false,
  shuyuStatus = null,
  durationSeconds = 15,
  value,
  disabled,
  onChange,
  onSelectedAvailabilityChange,
}: {
  canSelectVideoRoute: boolean;
  showInternalRoutes?: boolean;
  shuyuStatus?: ShuyuRouteUiStatus | null;
  durationSeconds?: number;
  value: VideoRouteOverride;
  disabled: boolean;
  onChange: (value: VideoRouteOverride) => void;
  onSelectedAvailabilityChange?: (available: boolean | null) => void;
}) {
  const { locale } = useTranslation();
  const copy = ROUTE_COPY[locale];
  const [resolvedShuyuStatus, setResolvedShuyuStatus] = useState(shuyuStatus);
  const [resolvedDirectAvailable, setResolvedDirectAvailable] = useState<
    boolean | null
  >(null);
  const [resolvedDirectRoutes, setResolvedDirectRoutes] = useState<
    VideoRouteUiStatus["directRoutes"] | null
  >(null);
  const [statusLoadFailed, setStatusLoadFailed] = useState(false);

  useEffect(() => {
    if (!canSelectVideoRoute) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setResolvedShuyuStatus(null);
      setResolvedDirectAvailable(null);
      setResolvedDirectRoutes(null);
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
        setResolvedDirectAvailable(status.directAvailable);
        setResolvedDirectRoutes(status.directRoutes);
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
    if (value === "buddy") {
      onSelectedAvailabilityChange(
        statusLoadFailed ? false : resolvedShuyuStatus?.available ?? null,
      );
      return;
    }
    if (value === "") {
      onSelectedAvailabilityChange(
        statusLoadFailed ? false : resolvedDirectAvailable,
      );
      return;
    }
    onSelectedAvailabilityChange(
      statusLoadFailed ? false : resolvedDirectRoutes?.[value] ?? null,
    );
  }, [
    onSelectedAvailabilityChange,
    resolvedDirectAvailable,
    resolvedDirectRoutes,
    resolvedShuyuStatus?.available,
    statusLoadFailed,
    value,
  ]);

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
  const directLabel = resolvedDirectAvailable === null
    ? statusLoadFailed ? copy.unavailable : copy.checking
    : resolvedDirectAvailable ? copy.available : copy.unavailable;
  const directRouteLabel = (
    routeId: Exclude<VideoRouteOverride, "" | "buddy">,
  ) => {
    const available = resolvedDirectRoutes?.[routeId];
    return available === undefined
      ? statusLoadFailed ? copy.unavailable : copy.checking
      : available ? copy.available : copy.unavailable;
  };
  const byteplusLabel = directRouteLabel("byteplus_international");
  const volcengineLabel = directRouteLabel("volcengine_cn_legacy");
  const shuyuEstimate = copy.shuyuEstimate.replace(
    "{points}",
    "900",
  );
  const shuyuDescription = `${copy.shuyuDescription} · ${shuyuEstimate}`;
  const selectedTitle = value === "buddy"
    ? copy.shuyuTitle
    : value === "byteplus_international"
      ? copy.byteplus
      : value === "volcengine_cn_legacy"
        ? copy.volcengine
        : copy.directTitle;
  const selectedDescription = value === "buddy"
    ? `${shuyuDescription} · ${shuyuLabel}`
    : `${copy.directDescription} · ${value === "byteplus_international"
      ? byteplusLabel
      : value === "volcengine_cn_legacy"
        ? volcengineLabel
        : directLabel}`;

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
            onValueChange={(nextValue) => onChange(parseVideoRouteOverride(nextValue))}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>{copy.label}</DropdownMenuLabel>
              <RouteRadioItem
                value=""
                icon={Server}
                title={copy.directTitle}
                description={copy.directDescription}
                status={directLabel}
                active={value === ""}
                warning={resolvedDirectAvailable === false || statusLoadFailed}
              />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
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
            {showInternalRoutes ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{copy.internalGroup}</DropdownMenuLabel>
                  <RouteRadioItem
                    value="byteplus_international"
                    icon={Server}
                    title={copy.byteplus}
                    description={copy.directDescription}
                    status={byteplusLabel}
                    active={value === "byteplus_international"}
                    disabled={resolvedDirectRoutes?.byteplus_international !== true}
                    warning={resolvedDirectRoutes?.byteplus_international !== true}
                  />
                  <RouteRadioItem
                    value="volcengine_cn_legacy"
                    icon={Server}
                    title={copy.volcengine}
                    description={copy.directDescription}
                    status={volcengineLabel}
                    active={value === "volcengine_cn_legacy"}
                    disabled={resolvedDirectRoutes?.volcengine_cn_legacy !== true}
                    warning={resolvedDirectRoutes?.volcengine_cn_legacy !== true}
                  />
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{copy.workspaceGroup}</DropdownMenuLabel>
            {copy.workspaceRoutes.map((routeName) => (
              <DropdownMenuItem
                key={routeName}
                aria-disabled="true"
                closeOnClick={false}
                onClick={(event) => event.preventDefault()}
                className="cursor-not-allowed items-start py-2.5 opacity-60"
              >
                <CircleAlert className="mt-0.5 size-4" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-body font-medium text-foreground">{routeName}</span>
                  <span className="mt-0.5 block text-meta text-muted-foreground">{copy.workspaceOnly}</span>
                </span>
              </DropdownMenuItem>
            ))}
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
  const directRoute = payload.routes.find(
    (candidate) =>
      isRecord(candidate) && candidate.id === payload.defaultRouteId,
  );
  const route = payload.routes.find(
    (candidate) => isRecord(candidate) && candidate.id === "buddy",
  );
  if (
    !isRecord(directRoute)
    || typeof directRoute.available !== "boolean"
    || !isRecord(route)
    || typeof route.configured !== "boolean"
    || typeof route.funded !== "boolean"
    || typeof route.available !== "boolean"
    || !(typeof route.unavailableReason === "string" || route.unavailableReason === null)
  ) {
    return null;
  }
  return {
    directAvailable: directRoute.available,
    directRoutes: Object.fromEntries(
      payload.routes
        .filter(
          (candidate) =>
            isRecord(candidate)
            && (candidate.id === "byteplus_international"
              || candidate.id === "volcengine_cn_legacy")
            && typeof candidate.available === "boolean",
        )
        .map((candidate) => [candidate.id, candidate.available]),
    ),
    shuyu: {
      configured: route.configured,
      funded: route.funded,
      available: route.available,
      reason: route.unavailableReason,
    },
  };
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
  disabled = false,
  warning = false,
}: {
  value: VideoRouteOverride;
  icon: typeof Server;
  title: string;
  description: string;
  status: string;
  active: boolean;
  disabled?: boolean;
  warning?: boolean;
}) {
  return (
    <DropdownMenuRadioItem
      value={value}
      disabled={disabled}
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
            "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px]",
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
