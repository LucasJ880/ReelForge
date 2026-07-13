import { Check, Minus, X, Star } from "lucide-react";
import { PetSection } from "./pet-section";
import {
  BENCHMARK_MATRIX,
  type BenchmarkCell,
} from "@/lib/demo/pet-content-kit-demo-data";

function CellMark({ value }: { value: BenchmarkCell }) {
  if (value === "core") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-meta font-semibold text-primary">
        <Star size={11} className="fill-current" /> 核心
      </span>
    );
  }
  if (value === "yes") {
    return <Check size={16} className="text-success" aria-label="有" />;
  }
  if (value === "partial") {
    return <Minus size={16} className="text-warning" aria-label="部分" />;
  }
  return <X size={15} className="text-muted-foreground/40" aria-label="无" />;
}

export function BenchmarkComparison() {
  const b = BENCHMARK_MATRIX;
  const aivoraIdx = b.columns.length - 1;
  return (
    <PetSection
      id="benchmark"
      eyebrow={b.eyebrow}
      title={b.title}
      description={b.description}
    >
      <p className="mb-2 text-meta font-medium text-muted-foreground/80 lg:hidden">
        ← 左右滑动查看完整对比（含 Aivora Kit）→
      </p>
      <div className="border border-border bg-card shadow-editorial overflow-hidden rounded-lg">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground sm:p-4">
                  能力
                </th>
                {b.columns.map((col, idx) => (
                  <th
                    key={col}
                    className={`px-2 py-3 text-center sm:p-4 text-xs font-semibold ${
                      idx === aivoraIdx
                        ? "bg-primary/10 text-primary"
                        : "text-foreground/70"
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row) => (
                <tr
                  key={row.feature}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="px-2 py-3 text-xs font-medium text-foreground/85 sm:p-4">
                    {row.feature}
                  </td>
                  <td className="px-2 py-3 text-center sm:p-4">
                    <div className="flex justify-center">
                      <CellMark value={row.ordinary} />
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center sm:p-4">
                    <div className="flex justify-center">
                      <CellMark value={row.aiCamera} />
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center sm:p-4">
                    <div className="flex justify-center">
                      <CellMark value={row.wearableMat} />
                    </div>
                  </td>
                  <td className="bg-primary/10 px-2 py-3 text-center sm:p-4">
                    <div className="flex justify-center">
                      <CellMark value={row.aivora} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        {b.painPoints.map((p) => (
          <div
            key={p}
            className="rounded-lg border border-border bg-card p-4 text-xs leading-6 text-muted-foreground"
          >
            {p}
          </div>
        ))}
      </div>

      <p className="mt-5 text-meta leading-5 text-muted-foreground/80">
        {b.sourceNote}
      </p>
    </PetSection>
  );
}
