/**
 * 老的风格模版与一致性锁的类型（2026-11-17 之前的做法）。模版表、关键词匹配、锁的清单都随老线路删了：
 * 现在的风格是「风格卡」，交给导演写手写进镜头脚本（director-line-policy.ts 的 DIRECTOR_STYLES）。
 * 这两个类型还留着，是因为拼方案记录的旧代码（consistency-bible、prompt-intelligence）的入参还带着它们，
 * 现在传进去的一律是 null / 空数组。
 */

export type StyleTemplateCategory =
  | "爆款广告"
  | "电商产品"
  | "UGC达人"
  | "探店种草"
  | "宠物萌宠";

export interface StyleTemplateScaffold {
  /// 注入 consistency-bible 的引导（角色/场景/光线弧的风格约束）
  characterHint?: string;
  environmentHint?: string;
  lightingHint?: string;
  /// 直接并入每段 prompt 的 Style 行（逗号分隔关键词，模版的「底盘」）
  styleKeywords: string;
  /// 主导镜头语言（引导 LLM 出分镜时的 camera 词汇）
  cameraLanguage: string;
  /// 分镜结构提示（如 "macro droplet reveal → slow orbit → texture close-up"）
  shotPattern: string;
  /// 台词/口播风格；null = 该模版默认无口播（纯氛围）
  dialogueStyle: string | null;
  /// 是否允许 Seedance 原生渲染短字幕（仅个别模版开启；有文字畸变风险）
  nativeCaptions?: {
    enabled: boolean;
    /// 字幕视觉风格说明（位置/样式），内容由 LLM 按镜头生成，每条 ≤10 字
    styleHint: string;
  };
}

export interface StyleTemplate {
  id: string;
  name: string;
  category: StyleTemplateCategory;
  /// UI 卡片描述（中文）
  description: string;
  /// UI 卡片图标（emoji）
  icon: string;
  /// 「套用」时预填到创作页的中文需求描述（用户可改）
  samplePrompt: string;
  /// 推荐默认值
  defaults: {
    durationSec: 15 | 30;
    language: string;
  };
  scaffold: StyleTemplateScaffold;
  /// 是否在库中标注「推荐」
  featured?: boolean;
  /// 爆款标签：按平台爆款广告数据反推的结构模版，UI 置顶展示 + 优先推荐
  viral?: boolean;
}

export interface ConsistencyLock {
  id: string;
  name: string;
  description: string;
  icon: string;
  /// 追加到每段 prompt 的约束行（英文）
  promptFragment: string;
  /// 追加到 negativePrompt 的片段（可选）
  negativeFragment?: string;
}

// ---------------------------------------------------------------------------
// 一致性锁（对齐同行「一致性锁」分类，可多选叠加）
// ---------------------------------------------------------------------------
