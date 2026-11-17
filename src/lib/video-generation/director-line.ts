/**
 * 线上创作台的导演线路（2026-11-17，线上对齐第 2 步）：让线上出的片和 Claude 这边 `npm run director` 出的片
 * 用同一套规则、同一个提示词拼法。
 *
 *   建故事板：导演写手（director-writer）看图写一份镜头脚本 → 只出一张开场帧（buildFramePrompt）
 *   出片：    整条片一次生成，提示词就是 buildVideoPrompt(job)，参考图 = 实拍图在前、开场帧最后
 *   合成：    字幕按脚本里每句台词所在镜头的时间烧（scriptSpeechWords）；口播与配乐由出片模型原生给
 *
 * 脚本存在 StoryboardRun.visualReference 这一列里（JSON，不加列）：它本来放的就是「建故事板时那次看图调用的产出」，
 * 旧的视觉盘点靠 photoCount 认，脚本靠 kind 认，两种形状互不误读。派发时再抄一份进 brief.directorPlan.directorLine，
 * 合成与重试都只读 brief，不回头找故事板。
 *
 * 只能在服务端引（director-plan 用了 node:crypto）。客户端要的判断与类型在 director-line-policy.ts。
 */
import {
  buildFramePrompt,
  buildVideoPrompt,
  directorSpokenLines,
  parseDirectorJob,
  partScript,
  scriptSpeechWords,
  videoReferenceOrder,
  type DirectorJob,
} from "@/lib/video-generation/director-plan";
import {
  compactDirectorJob,
  writeDirectorJob,
  type DirectorWriterCompleter,
  type DirectorWriterInput,
  type DirectorWriterScenario,
} from "@/lib/video-generation/director-writer";
import { DIRECTOR_LINE_TEMPLATE_ID, type DirectorScriptView } from "@/lib/video-generation/director-line-policy";

export const DIRECTOR_SCRIPT_KIND = "director_script";

/** 存在 StoryboardRun.visualReference / brief.directorPlan.directorLine 里的样子。 */
export interface StoredDirectorScript {
  kind: typeof DIRECTOR_SCRIPT_KIND;
  version: 1;
  job: DirectorJob;
  scenario: DirectorWriterScenario | null;
  model: string;
  attempts: number;
  /// 交付时还留着的提醒（不拦的那些），给运维看
  warnings: string[];
  /// 每个镜头给商家看的一句话（商家的语言），与 job.video.shots 一一对应；旧脚本 / 模型没写 = null
  shotNotes: Array<string | null>;
}

/** 故事板出图一次最多带几张参考图（Shuyu 图像档的硬顶是 6）。实拍图超过这个数只用前几张。 */
export const DIRECTOR_LINE_MAX_PHOTOS = 6;
/** 整个「写脚本」最多用多久；超过就不再改下一稿。建故事板的接口上限 300 秒，要给出图和兜底留余量。 */
export const DIRECTOR_LINE_WRITER_BUDGET_MS = 200_000;
/** 一次模型调用最多等多久。 */
export const DIRECTOR_LINE_WRITER_CALL_TIMEOUT_MS = 120_000;
/** 剩下的时间不够再写一稿（一稿实测几十秒）就收手。 */
const DIRECTOR_LINE_MIN_ROOM_FOR_NEXT_DRAFT_MS = 70_000;

export function packDirectorScript(result: {
  job: DirectorJob;
  scenario: DirectorWriterScenario | null;
  model: string;
  attempts: number;
  warnings: string[];
  shotNotes?: ReadonlyArray<string | null>;
}): Record<string, unknown> {
  return {
    kind: DIRECTOR_SCRIPT_KIND,
    version: 1,
    job: compactDirectorJob(result.job),
    scenario: result.scenario,
    model: result.model,
    attempts: result.attempts,
    warnings: result.warnings.slice(0, 20),
    shotNotes: result.job.video.shots.map((_, index) => result.shotNotes?.[index] ?? null),
  };
}

/** 只看是不是脚本（不解析）：判「这一轮该有几帧」这类每次读 run 都要问的地方用。 */
export function isStoredDirectorScript(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.kind === DIRECTOR_SCRIPT_KIND && record.version === 1;
}

/** 读回存下来的脚本；不是脚本、读不懂、版本不认识 → null（调用方当普通故事板处理）。 */
export function readStoredDirectorScript(value: unknown): StoredDirectorScript | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== DIRECTOR_SCRIPT_KIND || record.version !== 1) return null;
  try {
    const job = parseDirectorJob(record.job);
    const scenario =
      record.scenario && typeof record.scenario === "object" && !Array.isArray(record.scenario)
        ? (record.scenario as DirectorWriterScenario)
        : null;
    return {
      kind: DIRECTOR_SCRIPT_KIND,
      version: 1,
      job,
      scenario,
      model: typeof record.model === "string" ? record.model : "unknown",
      attempts: typeof record.attempts === "number" ? record.attempts : 1,
      warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : [],
      shotNotes: job.video.shots.map((_, index) => {
        const note = Array.isArray(record.shotNotes) ? record.shotNotes[index] : null;
        return typeof note === "string" && note.trim() ? note.trim() : null;
      }),
    };
  } catch {
    return null;
  }
}

/** 给故事板面板看的摘要。 */
export function directorScriptView(script: StoredDirectorScript): DirectorScriptView {
  const lines = directorSpokenLines(script.job);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    logline: script.job.video.logline,
    genre: script.job.genre ?? "fmcg",
    productType: script.job.productType ?? "",
    scenario: script.scenario
      ? {
          who: text(script.scenario.who),
          where: text(script.scenario.where),
          moment: text(script.scenario.moment),
          trouble: text(script.scenario.trouble),
          after: text(script.scenario.after),
          emotion: text(script.scenario.emotion),
        }
      : null,
    shots: script.job.video.shots.map((shot, index) => {
      const spoken = lines.filter((line) => line.shot === index + 1).map((line) => line.text);
      return {
        index: index + 1,
        fromSec: shot.fromSec,
        toSec: shot.toSec,
        action: shot.action.replace(/^Hard cut\.\s*/u, ""),
        note: script.shotNotes[index] ?? null,
        line: spoken.length > 0 ? spoken.join(" ") : null,
      };
    }),
  };
}

function referenceUrl(job: DirectorJob, id: string): string | null {
  const reference = job.references.find((candidate) => candidate.id === id);
  return reference && /^https:\/\//iu.test(reference.source) ? reference.source : null;
}

/** 开场帧的出图提示词与入参（实拍图，顺序 = 提示词里的 image N）。 */
export function directorOpeningFrame(job: DirectorJob): { prompt: string; inputImageUrls: string[] } {
  const frame = job.frames.find((candidate) => candidate.id === job.video.openingFrame) ?? job.frames[0]!;
  return {
    prompt: buildFramePrompt(job, frame),
    inputImageUrls: frame.references.map((id) => referenceUrl(job, id)).filter((url): url is string => Boolean(url)),
  };
}

/**
 * 出片的参考图地址，顺序与提示词里的 image N 一一对应：实拍图在前，开场帧最后。
 * 线上不用关键帧和分镜总览图（写手不产出它们）；万一脚本里有，这里对不上号 → null，调用方按「脚本不可用」处理。
 */
export function directorVideoReferenceUrls(job: DirectorJob, openingFrameUrl: string): string[] | null {
  const urls: string[] = [];
  for (const entry of videoReferenceOrder(job)) {
    if (entry.openingFrame) urls.push(openingFrameUrl);
    else if (entry.frame) return null;
    else {
      const url = referenceUrl(job, entry.id);
      if (!url) return null;
      urls.push(url);
    }
  }
  return urls;
}

/** 整条片的出片提示词（和 `npm run director -- check` 打出来的是同一个）。 */
export function directorVideoPrompt(job: DirectorJob): string {
  return buildVideoPrompt(job);
}

/** 字幕用的口播稿：脚本里的台词按先后连起来。没有台词是空串。 */
export function directorCaptionScript(job: DirectorJob): string {
  return partScript(directorSpokenLines(job), { fromSec: 0, toSec: job.durationSec });
}

/** 没有语音识别时的字幕时间：按脚本里每句台词所在的镜头推（形状与语音识别的逐字时间相同）。 */
export function directorScriptSpeechWords(job: DirectorJob): Array<{ text: string; startMs: number; endMs: number }> {
  return scriptSpeechWords(directorSpokenLines(job), { fromSec: 0, toSec: job.durationSec });
}

/** 台词用什么语言念：商家的描述里有汉字就是中文，否则英文。 */
export function directorVoiceLanguage(description: string): "zh-CN" | "en-US" {
  return /[㐀-鿿]/u.test(description) ? "zh-CN" : "en-US";
}

export interface DirectorLineWriteInput {
  /// 商家的原话
  description: string;
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  /// 商家实拍图（公开 https 地址），按上传顺序
  photos: Array<{ id: string; url: string }>;
  styleTemplateId?: string | null;
  /// 商家自己写好的口播稿（有就让写手照着排，不另编）
  voiceoverScript?: string | null;
  /// 脚本 id（小写字母、数字、连字符）
  jobId: string;
}

export type DirectorLineWriteResult =
  | { ok: true; script: StoredDirectorScript; stored: Record<string, unknown> }
  | { ok: false; cause: string };

export interface DirectorLineWriteDeps {
  complete: DirectorWriterCompleter;
  now?: () => number;
  budgetMs?: number;
  callTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 给一轮故事板写镜头脚本。任何失败（模型不可用、输出不合格、超出时间、输入不合格）都返回 ok: false + 原因，
 * 绝不抛：调用方据此退回老的故事板，并记一条降级。
 */
export async function writeDirectorScriptForStoryboard(
  input: DirectorLineWriteInput,
  deps: DirectorLineWriteDeps,
): Promise<DirectorLineWriteResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const budgetMs = deps.budgetMs ?? DIRECTOR_LINE_WRITER_BUDGET_MS;
  const callTimeoutMs = deps.callTimeoutMs ?? DIRECTOR_LINE_WRITER_CALL_TIMEOUT_MS;
  const remaining = () => budgetMs - (now() - startedAt);
  const narration = input.voiceoverScript?.trim();
  const description = narration
    ? `${input.description.trim()}\n\n商家已经写好的口播稿（台词照这份排进各个镜头，可以断句、不要改意思）：${narration}`
    : input.description.trim();
  const writerInput: DirectorWriterInput = {
    description: description.slice(0, 4_000),
    photos: input.photos.slice(0, DIRECTOR_LINE_MAX_PHOTOS),
    durationSec: input.durationSec === 30 ? 30 : 15,
    aspectRatio: input.aspectRatio,
    voiceLanguage: directorVoiceLanguage(input.description),
    ...(input.styleTemplateId === DIRECTOR_LINE_TEMPLATE_ID ? { genre: "fmcg" as const } : {}),
  };
  const complete: DirectorWriterCompleter = async (args) => {
    const room = remaining();
    if (room <= 5_000) throw new Error("director writer ran out of its time budget");
    const result = await withTimeout(deps.complete(args), Math.min(callTimeoutMs, room), "director writer call");
    complete.model = deps.complete.model;
    return result;
  };
  try {
    const result = await writeDirectorJob(writerInput, {
      complete,
      jobId: input.jobId,
      /// 开场帧带的是同一组图：出图一次最多 6 张，所以带给出片模型的实拍图也不超过 6 张（加开场帧 7 张）
      maxVideoPhotos: DIRECTOR_LINE_MAX_PHOTOS,
      outOfTime: () => remaining() < DIRECTOR_LINE_MIN_ROOM_FOR_NEXT_DRAFT_MS,
      onAttempt: (event) => {
        console.log(
          `[director-line] draft ${event.attempt}: ${event.outcome}${event.problems.length > 0 ? ` (${event.problems.length} to fix)` : ""}`,
        );
      },
    });
    if (!result.ok) {
      return { ok: false, cause: `director writer ${result.reason} after ${result.attempts} draft(s): ${result.lastErrors.slice(0, 3).join(" | ")}` };
    }
    /// 出片要的每张图都得是公开的 https 地址，而且提示词在供应商上限之内——这里不满足就别往下走
    const opening = directorOpeningFrame(result.job);
    if (opening.inputImageUrls.length !== (result.job.frames[0]?.references.length ?? 0)) {
      return { ok: false, cause: "director script references a photo without a public https address" };
    }
    const packed = {
      job: result.job,
      scenario: result.scenario,
      model: result.model,
      attempts: result.attempts,
      warnings: result.lint.warnings,
      shotNotes: result.shotNotes,
    };
    const stored = packDirectorScript(packed);
    const script = readStoredDirectorScript(stored);
    if (!script) return { ok: false, cause: "director script did not survive a store round-trip" };
    return { ok: true, script, stored };
  } catch (error) {
    return { ok: false, cause: error instanceof Error ? error.message : String(error) };
  }
}
