import { NextResponse } from "next/server";

interface ErrorRule {
  match: string | ((msg: string) => boolean);
  status: number;
}

const DEFAULT_RULES: ErrorRule[] = [
  { match: "项目不存在", status: 404 },
  { match: "发布记录不存在", status: 404 },
  { match: (m) => m.startsWith("当前状态"), status: 400 },
  { match: "请先生成内容方案", status: 400 },
  { match: "没有可用的视频", status: 400 },
  { match: "缺少内容方案", status: 400 },
  { match: "项目未发布", status: 400 },
  { match: "项目未成功发布", status: 400 },
  { match: "暂无数据", status: 400 },
  { match: "尚未生成内容方案", status: 404 },
  { match: "无有效字段", status: 400 },
];

export function handleApiError(
  error: unknown,
  label: string,
  extraRules?: ErrorRule[]
): NextResponse {
  const message = error instanceof Error ? error.message : String(error);

  const rules = [...DEFAULT_RULES, ...(extraRules || [])];
  for (const rule of rules) {
    const matched =
      typeof rule.match === "string"
        ? message.includes(rule.match)
        : rule.match(message);
    if (matched) {
      return NextResponse.json({ error: message }, { status: rule.status });
    }
  }

  console.error(`[${label}]`, error);
  return NextResponse.json(
    { error: `${label}失败`, detail: message },
    { status: 500 }
  );
}
