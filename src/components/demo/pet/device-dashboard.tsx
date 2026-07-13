import { BatteryMedium, Cctv, Dog, ScanLine } from "lucide-react";
import { PetSection } from "./pet-section";
import {
  petDevices,
  type PetDeviceDemo,
} from "@/lib/demo/pet-content-kit-demo-data";

const DEVICE_ICON = {
  camera: Cctv,
  collar: Dog,
  mat: ScanLine,
} as const;

const STATUS_STYLE = {
  online: "border-success bg-success/10 text-success",
  syncing: "border-warning bg-warning/10 text-warning",
  standby: "border-border bg-muted text-muted-foreground",
} as const;

export function DeviceDashboard() {
  return (
    <PetSection
      id="devices"
      eyebrow="实时采集状态 · Demo 模拟"
      title="三类硬件同时在线，自动采集真实宠物场景"
      description="摄像头、智能项圈与宠物垫传感器协同工作，自动捕捉宠物的真实瞬间，并为 AI 内容生产提供原始素材。以下设备状态为 demo 模拟数据，演示套装如何持续产生可用素材。"
    >
      <div className="grid gap-5 md:grid-cols-3">
        {petDevices.map((device) => (
          <DeviceCard key={device.key} device={device} />
        ))}
      </div>
    </PetSection>
  );
}

function DeviceCard({ device }: { device: PetDeviceDemo }) {
  const Icon = DEVICE_ICON[device.key];
  return (
    <div className="border border-border bg-card shadow-editorial flex flex-col rounded-(--radius-lg) p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-(--radius-lg) bg-success/10 text-success">
          <Icon size={22} />
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold ${STATUS_STYLE[device.status]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {device.statusLabel}
        </span>
      </div>

      <h3 className="mt-4 text-lg font-semibold text-foreground">
        {device.name}
      </h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {device.tagline}
      </p>

      {typeof device.battery === "number" ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <BatteryMedium size={16} className="text-success" />
          电量 {device.battery}%
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {device.metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-(--radius-lg) border border-border bg-background p-3 text-center"
          >
            <dt className="text-meta leading-4 text-muted-foreground">
              {m.label}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {m.value}
            </dd>
          </div>
        ))}
      </dl>

      <ul className="mt-4 space-y-2">
        {device.capabilities.map((c) => (
          <li
            key={c}
            className="flex items-start gap-2 text-xs leading-5 text-foreground/80"
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
