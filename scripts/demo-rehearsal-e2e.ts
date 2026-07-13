/**
 * Demo 彩排 · 前端视角全链路 HTTP 冒烟（登录 → 出脚本 → 出片 → 成片就绪）。
 *
 * 完全模拟 CEO 在 UI 上的操作序列（与 glass-create-workflow.tsx 的请求一一对应）：
 *   1. 注册/登录（next-auth credentials，拿 session cookie）
 *   2. POST /api/video-generation/plan       —— 「第一步：生成脚本」
 *   3. POST /api/video-generation/dispatch   —— 「确认出片」
 *   4. POST /api/briefs/{id}/render-status   —— 成片库自动刷新
 *
 * 任何一步非预期响应 → 非零退出（demo 前跑一遍，红了就别上台）。
 *
 * 用法（先起 mock dev server）：
 *   LLM_FORCE_MOCK=true VIDEO_ENGINE_MOCK=true IMAGE_ENGINE_MOCK=true \
 *     VIDEO_ENGINE_MOCK_LATENCY_MS=0 npx next dev -p 3100
 *   npm run demo:rehearsal            # 默认 http://localhost:3100
 *   DEMO_BASE_URL=http://localhost:3000 npm run demo:rehearsal
 */
export {};

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3100";
const EMAIL = "demo-rehearsal@aivora.test";
const PASSWORD = "rehearsal-passw0rd";

/// 与真实上传后的产品图等价（demo 服里已存在的公开 blob 图）
const CURTAIN_IMAGES = [
  "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/curtain-demo/img7_cream_luxury_bedroom.png",
  "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/curtain-demo/img4_vaulted_luxury.png",
];

let cookieJar = "";

function mergeCookies(res: Response) {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const [name] = pair.split("=");
    const others = cookieJar
      .split("; ")
      .filter((x) => x && !x.startsWith(`${name}=`));
    cookieJar = [...others, pair].join("; ");
  }
}

async function req(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: Record<string, unknown> | null; res: Response }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookieJar ? { cookie: cookieJar } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  mergeCookies(res);
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.clone().json()) as Record<string, unknown>;
  } catch {
    /* html / empty */
  }
  return { status: res.status, json, res };
}

function step(n: number, title: string) {
  console.log(`\n[${n}] ${title}`);
}

function fail(msg: string): never {
  console.error(`\n❌ DEMO 彩排失败：${msg}`);
  process.exit(1);
}

async function login() {
  step(1, "注册/登录 demo 账号");
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Demo Rehearsal" }),
  });
  if (reg.status !== 200 && reg.status !== 409) {
    fail(`注册接口异常 HTTP ${reg.status}: ${JSON.stringify(reg.json)}`);
  }
  console.log(`  注册：${reg.status === 200 ? "新建成功" : "已存在（复用）"}`);

  const csrfRes = await req("/api/auth/csrf");
  const csrfToken = (csrfRes.json?.csrfToken as string) ?? "";
  if (!csrfToken) fail("拿不到 next-auth csrfToken");

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieJar,
    },
    body: new URLSearchParams({
      email: EMAIL,
      password: PASSWORD,
      csrfToken,
      json: "true",
    }),
    redirect: "manual",
  });
  mergeCookies(loginRes);
  if (!cookieJar.includes("next-auth.session-token")) {
    fail(`登录失败（无 session cookie），HTTP ${loginRes.status}`);
  }
  const session = await req("/api/auth/session");
  const user = session.json?.user as { email?: string } | undefined;
  if (user?.email !== EMAIL) fail("session 校验失败");
  console.log(`  登录成功：${user.email}`);
}

function buildRequest() {
  /// 与 glass-create-workflow buildRequest() 完全同构
  return {
    userType: "personal" as const,
    rawPrompt:
      "15秒窗帘广告：奶油色蛇形帘豪宅卧室，成果前置爆款结构，突出高级质感与遮光效果。",
    attachments: CURTAIN_IMAGES.map((url, i) => ({
      id: `demo_curtain_${i + 1}`,
      type: "IMAGE" as const,
      inferredRole: "product_image" as const,
      roleConfidence: 0.9,
      url,
      mimeType: "image/png",
      fileName: `curtain-${i + 1}.png`,
      width: 768,
      height: 1024,
    })),
    selectedDuration: 15 as const,
    selectedAspectRatio: "9:16" as const,
    selectedBrandEndingMode: "none" as const,
    platform: "tiktok" as const,
    language: "zh-CN",
    styleTemplateId: "tpl_viral_result_first",
    consistencyLockIds: ["lock_product_shape", "lock_lighting"],
  };
}

async function main() {
  console.log(`=== Aivora Demo 彩排 · ${BASE} ===`);

  await login();

  step(2, "生成脚本（/api/video-generation/plan，爆款模版 tpl_viral_result_first）");
  const planRes = await req("/api/video-generation/plan", {
    method: "POST",
    body: JSON.stringify(buildRequest()),
  });
  if (planRes.status !== 200 || !planRes.json?.ok) {
    fail(`plan 失败 HTTP ${planRes.status}: ${JSON.stringify(planRes.json).slice(0, 300)}`);
  }
  const plan = planRes.json.plan as {
    qualityReview: { canDispatch: boolean; blockers: unknown[] };
    segments: Array<{ type: string; order: number; prompt: string | null }>;
    planPreview: { summary: string };
  };
  if (!plan.qualityReview.canDispatch) {
    fail(`plan 有 blocker: ${JSON.stringify(plan.qualityReview.blockers)}`);
  }
  const aiSegs = plan.segments.filter((s) => s.type === "ai_generated_clip");
  if (aiSegs.length === 0 || aiSegs.some((s) => !s.prompt || s.prompt.length < 50)) {
    fail("AI 段 prompt 缺失或过短");
  }
  console.log(`  ✓ 脚本就绪：${aiSegs.length} 镜 · ${plan.planPreview.summary.slice(0, 60)}…`);

  step(3, "确认出片（/api/video-generation/dispatch，batchCount=1）");
  const dispatchRes = await req("/api/video-generation/dispatch", {
    method: "POST",
    body: JSON.stringify({
      request: buildRequest(),
      confirmedPrompts: [],
      batchCount: 1,
    }),
  });
  if (dispatchRes.status !== 200 || !dispatchRes.json?.ok) {
    fail(
      `dispatch 失败 HTTP ${dispatchRes.status}: ${JSON.stringify(dispatchRes.json).slice(0, 300)}`,
    );
  }
  const briefId = dispatchRes.json.briefId as string;
  const nextUrl = dispatchRes.json.nextUrl as string;
  console.log(`  ✓ 已出片：briefId=${briefId} nextUrl=${nextUrl}`);

  step(4, "轮询成片状态（/api/briefs/{id}/render-status）");
  const started = Date.now();
  for (;;) {
    const st = await req(`/api/briefs/${briefId}/render-status`, { method: "POST" });
    if (st.status !== 200) {
      fail(`render-status 失败 HTTP ${st.status}: ${JSON.stringify(st.json).slice(0, 200)}`);
    }
    const s = st.json as unknown as {
      briefStatus: string;
      succeeded: number;
      failed: number;
      totalJobs: number;
      finalVideoUrl: string | null;
    };
    console.log(
      `  … status=${s.briefStatus} segments=${s.succeeded}/${s.totalJobs} failed=${s.failed}`,
    );
    if (s.failed > 0) fail("有片段生成失败");
    if (s.finalVideoUrl) {
      console.log(`  ✓ 成片就绪：${s.finalVideoUrl.slice(0, 90)}…`);
      break;
    }
    if (Date.now() - started > 120_000) fail("2 分钟内未就绪（mock 模式应秒级完成）");
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\n✅ Demo 彩排通过：登录 → 脚本 → 出片 → 成片全链路无 error。");
}

main().catch((err) => {
  fail((err as Error).message);
});
