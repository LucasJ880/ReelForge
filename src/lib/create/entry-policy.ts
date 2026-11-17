/**
 * 创作页入口的 A 级开关（2026-10-28 晚上线前精简，docs/roadmap/2026-10-28-launch-review.md §5）。
 * A 级 = 只撤入口：组件、接口与数据全保留，放回时改成 true。删代码（C 级）另提删除提交。
 *
 * 纯常量模块：客户端组件也引用，不得引入服务端依赖。
 *
 * 2026-11-16 第 2 批瘦身：这里原来还有三个开关——实拍图库线路（BROLL_ROUTE_ENTRY_ENABLED）、
 * 贴商品链接（PRODUCT_LINK_ENTRY_ENABLED）、品牌页商品主体抠图（PRODUCT_ANCHOR_ENTRY_ENABLED）。
 * 三条线路的组件、接口与供应商代码已经整段删除（C 级），开关随之拿掉；要放回得从 git 历史取回代码，
 * 不是改个开关。数据库里的表与已有记录（ProductAnchor、旧的 b-roll 成片）都留着。
 */

/// 产品图工作台（/app/create/images）的「生成视频 / 产品图片」切换：商品图改进品牌套件（P1）。
export const PRODUCT_IMAGE_STUDIO_ENTRY_ENABLED = false;
