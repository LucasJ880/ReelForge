/* 演示内容用真实客户 SunnyShutter（多伦多定制百叶窗），不用占位文案 */

const NAV = [
  { group: "每天", items: [
    { id: "today", label: "今天", icon: "IcToday", count: "3 待办" },
    { id: "create", label: "创作", icon: "IcCreate" },
    { id: "calendar", label: "日历", icon: "IcCalendar", count: "本周 5" },
  ]},
  { group: "资产与洞察", items: [
    { id: "library", label: "素材库", icon: "IcLibrary", count: "128" },
    { id: "intel", label: "同行灵感", icon: "IcIntel", count: "新 12" },
    { id: "racing", label: "战绩", icon: "IcRacing" },
    { id: "brand", label: "品牌包", icon: "IcBrand" },
  ]},
  { group: "本设计稿", items: [
    { id: "ia", label: "信息架构全景", icon: "IcMap" },
  ]},
];

/* 本周发布节奏 —— 日历的浓缩视图 */
const WEEK = [
  { day: "周一", date: "27", posts: [{ kind: "video", ch: "TikTok", state: "published" }] },
  { day: "周二", date: "28", posts: [{ kind: "carousel", ch: "Instagram", state: "published" }] },
  { day: "周三", date: "29", posts: [{ kind: "video", ch: "TikTok", state: "scheduled" }, { kind: "image", ch: "Facebook", state: "scheduled" }] },
  { day: "周四", date: "30", posts: [] },
  { day: "周五", date: "31", posts: [{ kind: "video", ch: "Instagram", state: "draft" }] },
  { day: "周六", date: "01", posts: [] },
  { day: "周日", date: "02", posts: [] },
];

/* 待办 —— 只放"需要商家做决定"的事，不放系统噪音 */
const TODOS = [
  { id: 1, tone: "warn", title: "周四、周六没有内容", body: "按你的节奏建议每周 5 条。要我用赢家结构补两条吗？", cta: "补两条" },
  { id: 2, tone: "mute", title: "3 张产品图等你确认", body: "白底棚拍已生成，确认后可直接进视频或排期。", cta: "去确认" },
  { id: 3, tone: "good", title: "上周赢家已派生 2 个变体", body: "「前 3 秒直接给结果」这个结构又赢了，变体已排进下周一。", cta: "看变体" },
];

/* 赛马结论 —— 配方维度，不是帖子维度。这是与平台看板的分野 */
const RECIPES = [
  { id: "r1", name: "前 3 秒直接给结果", n: 14, lift: 3.1, trend: [8,11,9,14,18,22,26], state: "winning", note: "装完的窗先出现，再回到装之前" },
  { id: "r2", name: "安装过程延时", n: 11, lift: 1.4, trend: [10,12,11,13,12,15,16], state: "steady", note: "量尺到装完压成 8 秒" },
  { id: "r3", name: "提问式开场", n: 9,  lift: 0.6, trend: [14,12,10,9,8,7,6], state: "losing", note: "「你家窗帘还在用布的吗」" },
  { id: "r4", name: "客户口述好评", n: 3,  lift: null, trend: [6,7,5,8,6,7,7], state: "thin", note: "样本不足，还判不了" },
];

/* 一句话起片 —— 多形态产出 */
const SEED = "我家做定制百叶窗，想让多伦多的业主来约免费上门量尺";

const OUTPUTS = [
  { id: "o1", kind: "video", label: "短视频", spec: "9:16 · 15 秒", state: "ready",
    title: "装完 vs 装之前", recipe: "前 3 秒直接给结果",
    note: "产品锚定已过校验 · logo 出现在窗台样品册上" },
  { id: "o2", kind: "carousel", label: "轮播", spec: "4:5 · 4 屏", state: "ready",
    title: "选百叶窗看这 4 件事", recipe: "清单式",
    note: "封面用同一张锚点图，色调与视频一致" },
  { id: "o3", kind: "image", label: "单图帖", spec: "1:1", state: "ready",
    title: "白底产品主图 + 报价钩子", recipe: "价格锚点",
    note: "可直接回写到商品主图" },
  { id: "o4", kind: "text", label: "文案与话题标签", spec: "4 版", state: "ready",
    title: "同一条片子的 4 种开场", recipe: "钩子矩阵",
    note: "含本地化标签：#TorontoHome #Shutters" },
];

/* 信息架构：新旧对照 —— 这张表是给实施方看的，避免跑偏 */
const IA_NEW = [
  { id: "today", name: "今天", why: "本周节奏 / 待决定的事 / 赢家提示", owner: "Aivora" },
  { id: "create", name: "创作", why: "一句话·一张图·一个链接 → 多形态产出", owner: "Aivora" },
  { id: "calendar", name: "日历", why: "排期与发布状态（青砚 + Postiz 承担执行）", owner: "青砚" },
  { id: "library", name: "素材库", why: "图 / 片 / 轮播 / 文案，按业务对象组织", owner: "Aivora" },
  { id: "intel", name: "同行灵感", why: "公开广告库里长期在投的结构", owner: "Aivora" },
  { id: "racing", name: "战绩", why: "哪个配方在赢 → 派生变体", owner: "Aivora + 青砚数据" },
  { id: "brand", name: "品牌包", why: "Logo / 色板 / 构图与摄影风格配方", owner: "Aivora" },
];

const IA_OLD = [
  { name: "创作", fate: "keep", note: "保留，但入口从「上传素材」改成「一句话」" },
  { name: "批量生产", fate: "fold", note: "折进创作，作为一种模式而不是顶级导航" },
  { name: "模板库", fate: "fold", note: "折进创作与品牌包（构图/摄影风格配方）" },
  { name: "投放与赛马", fate: "rebuild", note: "按创意配方归因重写，旧实现只作参考" },
  { name: "成品库", fate: "merge", note: "与产品图库合并成统一素材库" },
  { name: "品牌", fate: "keep", note: "升级成 Brand Kit（色板 / 安全区 / 两份配方）" },
  { name: "/internal/* 19 个页面", fate: "retire", note: "旧代运营中台，A 级下线入口" },
];

const KIND_META = {
  video:    { icon: "IcVideo",    label: "视频" },
  carousel: { icon: "IcCarousel", label: "轮播" },
  image:    { icon: "IcImage",    label: "图片" },
  text:     { icon: "IcText",     label: "文案" },
};

const STATE_META = {
  published: { tone: "good", label: "已发布" },
  scheduled: { tone: "mute", label: "已排期" },
  draft:     { tone: "warn", label: "草稿" },
};

Object.assign(window, {
  NAV, WEEK, TODOS, RECIPES, SEED, OUTPUTS, IA_NEW, IA_OLD, KIND_META, STATE_META,
});
