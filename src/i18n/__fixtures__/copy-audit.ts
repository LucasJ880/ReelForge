/**
 * Copy Audit Fixture (Phase 5 — Unified Input)
 *
 * 列出主要面向客户的 UI 与对应的 i18n key —— 用作:
 *   1) 文档：让审计人/翻译者一眼看到每页该用哪些字典
 *   2) 测试 fixture：tests/i18n-coverage.test.ts 用它扫描页面源码，
 *      确保不再出现「赛马 / 渲染 / Angle / SEEDANCE / provider / task id」等内部词
 *
 * Phase 5 清理：旧 wizard / `(app)/projects` / `(app)/videos` / `(app)/app-sidebar`
 * 已退役并删除，因此从清单中移除。新的 Unified Creative Input 相关组件
 * （unified-creative-input.tsx / attachment-uploader.tsx / plan-preview-card.tsx）
 * 目前仍以英文为主 + 少量中文混排，i18n 化留作 Phase 2 任务，暂不进入清单。
 *
 * 设计原则：
 * - debug.* namespace 才允许出现 provider/jobId/raw status 等内部术语
 * - 主 UI 只能用 nav.* / brand.* / logo.* / creative.* / video.* / status.* 这些 key
 */

export interface CopyAuditEntry {
  /// 相对路径，相对仓库根
  file: string;
  /// 在该文件里要使用的 i18n key 列表
  i18nKeys: string[];
  /// 描述
  description: string;
  /// 主 UI 必须不再出现这些字符串
  forbidden?: string[];
}

export const COPY_AUDIT_TABLE: CopyAuditEntry[] = [
  {
    file: "src/components/layout/language-switcher.tsx",
    description: "语言切换下拉",
    i18nKeys: ["language.switch", "language.current"],
  },
  {
    file: "src/components/wizard/logo-generator-dialog.tsx",
    description: "AI Logo 生成对话框（Phase 5 仍保留为品牌资产生成入口）",
    i18nKeys: [
      "logo.title",
      "logo.subtitle",
      "logo.actions.generate",
      "logo.actions.regenerate",
      "logo.actions.select",
      "logo.actions.cancel",
      "logo.states.generating",
      "logo.states.generated",
      "logo.states.failed",
      "logo.states.mockNotice",
      "logo.form.businessName",
      "logo.form.industry",
      "logo.form.style",
      "logo.form.colors",
      "logo.form.slogan",
      "logo.form.iconIdea",
      "logo.style.modern",
      "logo.style.minimal",
      "logo.style.luxury",
      "logo.style.playful",
      "logo.style.tech",
      "logo.style.natural",
      "logo.style.local",
    ],
  },
  {
    file: "src/components/features/render-progress.tsx",
    description: "视频生成进度面板（4 步进度 + 多段拼接 + 失败重试 + debug 抽屉）",
    i18nKeys: [
      "video.progress.scriptReady",
      "video.progress.submitted",
      "video.progress.generating",
      "video.progress.stitching",
      "video.progress.ready",
      "video.progress.segments",
      "video.actions.preview",
      "video.actions.refreshStatus",
      "video.actions.retryFailed",
      "video.actions.regenerate",
      "video.states.waiting",
      "video.states.submitted",
      "video.states.generating",
      "video.states.stitching",
      "video.states.ready",
      "video.states.failed",
      "video.states.stuck",
      "video.states.cancelled",
      "video.helpers.waiting",
      "video.helpers.submitted",
      "video.helpers.generating",
      "video.helpers.stitching",
      "video.helpers.ready",
      "video.helpers.failed",
      "video.helpers.stuck",
      "video.helpers.cancelled",
      "common.retry",
      "common.showAdvanced",
      "common.hideAdvanced",
      "debug.provider",
      "debug.externalJobId",
      "debug.rawStatus",
    ],
    /// 主 UI 不再直接出现这些内部词；它们只允许出现在 debug.* / showDebug=true 的 pre 块中
    forbidden: [
      "SEEDANCE_T2V",
      "SEEDANCE_I2V",
      "external_job_id",
      "auto_pass",
      "渲染任务",
    ],
  },
];

/**
 * 把 forbidden 词聚合成一份扫描列表（测试用）。
 */
export function collectForbidden(): string[] {
  const set = new Set<string>();
  for (const entry of COPY_AUDIT_TABLE) {
    for (const word of entry.forbidden ?? []) {
      set.add(word);
    }
  }
  return Array.from(set);
}

/**
 * 默认主 UI 路径名单（i18n-coverage 测试用）。
 * 这些路径下出现的 JSX 字符串文本必须满足：
 *   - 要么来自 i18n 字典
 *   - 要么是品牌专有名（"Aivora" / "TikTok" 等）
 *   - 要么是 debug 抽屉里的内容
 *
 * Phase 5：旧 wizard / projects / videos 路径已删除，从清单中移除。
 * 新的 (business)/(personal)/(internal) 路由组短期内允许中英混排，
 * 暂不强制进入 i18n-coverage 检查。
 */
export const PRIMARY_UI_PATHS = [
  "src/components/layout/language-switcher.tsx",
  "src/components/features/render-progress.tsx",
  "src/components/wizard/logo-generator-dialog.tsx",
];
