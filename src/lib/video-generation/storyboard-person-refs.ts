/**
 * 主播参考图（AssetRole `person`）进故事板的放行策略（P02-D(s)）。
 *
 * 开关 `STORYBOARD_PERSON_REFS`：
 * - `off`（默认）：契约接受字段但非空即 400——UI 还没露出，先把 service 与存储做稳；
 * - `internal`：只有内部员工（SUPER_ADMIN / OPERATOR）可传，用于 E15 拒单率实验；
 * - `on`：全员可传（P02-D2 决定何时切）。
 *
 * 纯模块：路由与测试共用，不引入服务端依赖。
 */
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
