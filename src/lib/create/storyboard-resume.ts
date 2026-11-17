/**
 * 创作页打开时，上一轮没走完的故事板要不要自动带回表单（2026-11-17）。
 *
 * 背景：恢复请求要先跟供应商对账，可能几十秒后才回来。原来只看「用户动没动过」一个记号，回来就把那一轮的
 * 商品图、描述、时长整个填回表单——11-17 线上实测两次把刚填的内容换掉，其中一次带回来的还是一天前失败的一轮。
 *
 * 规矩：
 * - 那一轮已取消、或者页面上已经有新做的故事板 → 什么都不做；用户说过「不用了」的那一轮也不再提，
 *   除非他又点「回创作页继续」明确回来找它；
 * - 表单还是空的，而且那一轮还在进行中（出画面 / 等确认 / 已确认没出片）→ 直接带回来（刷新后不能丢，0805 的教训）；
 * - 用户是点成品库的「回创作页继续」明确过来的（resume=1），表单又是空的 → 失败的那一轮也直接带回来；
 * - 其余（表单已经有内容，或那一轮早就失败了）→ 不动表单，只给一条提示让用户自己选。
 *
 * 纯函数，客户端与测试共用，不引任何服务端模块。
 */
export type StoryboardResumeDecision = "ignore" | "apply" | "offer";

export function decideStoryboardResume(input: {
  /// 那一轮故事板的状态（StoryboardRunView.status）
  runStatus: string;
  /// 用户动过任何输入，或表单里已经有内容 / 正在上传
  formTouched: boolean;
  /// 带着 ?resume=1 过来
  resumeRequested: boolean;
  /// 用户在这台设备上对这一轮点过「不用了」/ 退出过
  dismissed: boolean;
  /// 页面上已经有一轮故事板（请求还没回来，用户已经新做了一轮）
  storyboardOnPage: boolean;
}): StoryboardResumeDecision {
  if (input.runStatus === "CANCELLED" || input.storyboardOnPage) return "ignore";
  /// 说过「不用了」的那一轮不再提；但用户又点「回创作页继续」明确回来找它，就照常处理
  if (input.dismissed && !input.resumeRequested) return "ignore";
  if (input.formTouched) return "offer";
  return input.runStatus !== "FAILED" || input.resumeRequested ? "apply" : "offer";
}
