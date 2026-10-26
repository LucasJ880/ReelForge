/**
 * 主播参考图（AssetRole `person`）的放行策略（P02-D(s)）。
 *
 * 开关 `STORYBOARD_PERSON_REFS`：
 * - `off`（默认）：契约接受字段但非空即 400；文字锚（bible / 段提示词）也不认 person 素材——
 *   P02-F(v) 打开分组、真正把主播 URL 放进视频参考之前，提示词里不能先写「照着主播照片拍」；
 * - `internal`：只有内部员工（SUPER_ADMIN / OPERATOR）可传，用于 E15 拒单率实验；
 * - `on`：全员可传（P02-D2 决定何时切）。
 *
 * 角色校验在 API 边界做（故事板 / plan / dispatch 路由）；bible 与段提示词只看开关是否打开。
 * 只依赖 types：路由、服务端模块与测试共用。
 */
import { effectiveAssetRole, type UploadedAsset } from "@/types/video-generation";

export const STORYBOARD_PERSON_REFS_MAX = 4;

export type StoryboardPersonRefsMode = "off" | "internal" | "on";

export function storyboardPersonRefsMode(
  env: Record<string, string | undefined> = process.env,
): StoryboardPersonRefsMode {
  const raw = env.STORYBOARD_PERSON_REFS?.trim().toLowerCase();
  if (raw === "on" || raw === "internal") return raw;
  return "off";
}

export function canSubmitStoryboardPersonRefs(input: {
  mode: StoryboardPersonRefsMode;
  isInternal: boolean;
}): boolean {
  if (input.mode === "on") return true;
  if (input.mode === "internal") return input.isInternal;
  return false;
}

/**
 * 文字锚只认开关放行后的主播参考图：开关 off 时，即便素材标了 person 也当不存在
 * （它仍然不算商品图、不进时间轴——那是 AssetRole 的语义，与开关无关）。
 */
export function presenterReferenceAssets<T extends UploadedAsset>(
  assets: readonly T[],
  mode: StoryboardPersonRefsMode = storyboardPersonRefsMode(),
): T[] {
  if (mode === "off") return [];
  return assets.filter((asset) => effectiveAssetRole(asset) === "person");
}

/**
 * 统一创作请求（/plan、/dispatch）里是否有素材按生效角色（userAssignedRole ?? inferredRole）算主播参考图——
 * 与文字锚用的 effectiveAssetRole 同一判据，客户端填 inferredRole=person 也绕不过门
 *（schema 另有一道：新建请求的 inferredRole 不接受 person，分类器从不推断它）。
 */
export function hasPersonTaggedAttachment(
  attachments: ReadonlyArray<{ inferredRole?: string | null; userAssignedRole?: string | null }>,
): boolean {
  return attachments.some(
    (attachment) => (attachment.userAssignedRole ?? attachment.inferredRole) === "person",
  );
}
