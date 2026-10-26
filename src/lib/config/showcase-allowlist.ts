/**
 * 成品库「SunnyShutter 客户样片」白名单（2026-10-25 审计 A10）。
 *
 * 之前：样片账号（SHOWCASE_LIBRARY_EMAIL，默认 demo@aivora.app）名下**全部**已完成内容
 * 默认注入每个账号的成品库——里面混着不是 SunnyShutter 的测试片。现在只注入这里点名的条目：
 *  - 默认空 ⇒ 什么都不注入：成品库列表、详情页、批次详情都不再露出样片账号的任何内容；
 *  - 只认样片账号自己名下、且已成片的条目——点名了别人的 id 也不会注入；
 *  - 注入的条目一律标「样片」、只读（不能重新生成 / 品牌封装 / 取消），不计入任何读数，
 *    与状态栏「不含示例数据」、成品库「不含样片」同一口径；
 *  - LIBRARY_SHOWCASE=off 仍然一键关闭。
 *
 * 由创始人会话按生产数据填写（只填核实过是 SunnyShutter 客户成片、且有书面许可展示的）：
 *  - final_video：单条订单的成片 FinalVideo.id；
 *  - order：单条订单 DeliveryOrder.id（成品库详情页 /app/library/<id> 里的 id）；
 *    旧的单段流程没有 FinalVideo，用它；
 *  - batch_video：批量成片 VideoJob.id（成品库行 id 去掉 `batch-` 前缀）。
 *    批次详情页会把整批只读展示出来，所以只放整批都是 SunnyShutter 样片的批次里的条目；
 *  - content_post：图文帖 ContentPost.id。
 *
 * 纯常量模块（不 import 任何东西）：改这里不需要碰别的代码。
 */
export type ShowcaseSampleKind = "final_video" | "order" | "batch_video" | "content_post";

export type ShowcaseSample = {
  kind: ShowcaseSampleKind;
  id: string;
  /** 给人看的备注（哪条片、谁核实的），不参与逻辑。 */
  note?: string;
};

export const SHOWCASE_SAMPLES: readonly ShowcaseSample[] = [
  // { kind: "final_video", id: "<FinalVideo.id>", note: "SunnyShutter 遮阳帘 · 9:16 · 已获书面许可" },
];
