/**
 * 创作页入口的 A 级开关（2026-10-28 晚上线前精简，docs/roadmap/2026-10-28-launch-review.md §5）。
 * A 级 = 只撤入口：组件、接口与数据全保留，放回时改成 true。删代码（C 级）另提删除提交。
 *
 * 纯常量模块：客户端组件也引用，不得引入服务端依赖。
 */

/// 实拍图库线路（Pexels 实拍素材 + TTS 口播的独立出片卡）：与主线重复，Runway 能直接生成同类画面。
export const BROLL_ROUTE_ENTRY_ENABLED = false;

/// 产品图工作台（/app/create/images）的「生成视频 / 产品图片」切换：商品图改进品牌套件（P1）。
export const PRODUCT_IMAGE_STUDIO_ENTRY_ENABLED = false;
