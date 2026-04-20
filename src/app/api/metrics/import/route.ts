import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/api-auth";
import {
  importMetricsCsv,
  METRICS_CSV_TEMPLATE,
  recordMetricsSnapshot,
} from "@/lib/services/metrics-service";
import { metricsRowSchema } from "@/lib/validators";

export async function GET() {
  return new NextResponse(METRICS_CSV_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="metrics_template.csv"',
    },
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body.csv) {
        const results = await importMetricsCsv(body.csv);
        return NextResponse.json({ results });
      }
      const parsed = metricsRowSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "参数错误", details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      const snap = await recordMetricsSnapshot({
        publishRecordId: parsed.data.publishRecordId,
        windowHours: parsed.data.windowHours,
        metrics: parsed.data.metrics,
      });
      return NextResponse.json(snap);
    }
    if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
      const csv = await req.text();
      const results = await importMetricsCsv(csv);
      return NextResponse.json({ results });
    }
    return NextResponse.json(
      { error: "不支持的 Content-Type" },
      { status: 415 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
