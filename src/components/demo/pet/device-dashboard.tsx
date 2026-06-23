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
  online: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  syncing: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  standby: "border-stone-400/30 bg-stone-400/10 text-stone-600",
} as const;

export function DeviceDashboard() {
  return (
    <PetSection
      id="devices"
      eyebrow="设备 Dashboard"
      title="智能硬件，自动采集真实宠物场景"
      description="摄像头、智能项圈与宠物垫传感器协同工作，自动捕捉宠物的真实瞬间，并为 AI 内容生产提供原始素材。硬件入口清晰，未来可持续扩展。"
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
    <div className="pet-surface flex flex-col rounded-3xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--pet-teal)]/12 text-[color:var(--pet-teal)]">
          <Icon size={22} />
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[device.status]}`}
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
          <BatteryMedium size={16} className="text-[color:var(--pet-teal)]" />
          电量 {device.battery}%
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {device.metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border border-border bg-background/60 p-3 text-center"
          >
            <dt className="text-[10px] leading-4 text-muted-foreground">
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
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pet-orange)]" />
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
