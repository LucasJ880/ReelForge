// 数据镜像真实系统状态（2026-07-20 shade batch v2 实况）
const AIVORA_DATA = {
  client: {
    name: "SunnyShutter",
    location: "Scarborough, ON · 窗帘/百叶定制厂",
    phone: "647-857-8669",
    address: "690 Progress Ave, Unit 7&8",
    logo: "assets/sunny-logo.png",
    endCard: "assets/end-card-9x16.png",
    balance: "151,336",
  },
  locks: [
    { name: "窗户主角锁", why: "同一扇窗占画面主体、机位不变，人物退居配角（CEO 0720）" },
    { name: "单场景防幻视锁", why: "一房一窗一机位；禁交叉溶解 / 叠影 / 房间漂移" },
    { name: "拉珠侧边锁", why: "拉珠/珠链只允许出现在帘头左或右边缘，永不居中" },
    { name: "裁尾 0.8s + 真尾卡", why: "砍掉模型假名片幻觉，后期拼精确电话地址尾卡" },
    { name: "故事版 5 帧抽卡", why: "每帧 4 候选 + AI 评审择优；帧间图像锚定一致性" },
  ],
  imageLanes: [
    { id: "image-plan-11", name: "Nano Banana · Gemini 3 Pro", res: "2K", pts: 48, on: true, primary: true },
    { id: "image-plan-14", name: "Nano Banana · Gemini 3.1 Flash", res: "2K", pts: 32, on: true },
    { id: "image-plan-12", name: "Nano Banana · Gemini 3 Pro", res: "4K", pts: 80, on: true },
    { id: "image-plan-15", name: "Nano Banana · Gemini 3.1 Flash", res: "4K", pts: 72, on: true },
  ],
  videoLanes: [
    { id: "video-plan-03", name: "Seedance Fast VIP · 推荐 1", pts: "88/s", on: true, primary: true },
    { id: "video-plan-05", name: "Seedance Fast VIP · 推荐 2", pts: "88/s", on: true },
    { id: "video-plan-02", name: "Seedance VIP 平价（兜底）", pts: "900/条", on: false },
  ],
  batch: {
    key: "shade-batch10-v2",
    label: "Shades ×10 · 15s · Plan A（6卷帘+2斑马+2纱帘）",
    items: [
      { i: 1, name: "卷帘 · 晨光刺眼", status: "done", plan: "video-plan-03", judge: "评审 fail-open（首卡）" },
      { i: 2, name: "卷帘 · 遮光睡眠", status: "done", plan: "video-plan-03", judge: "评审 8.5 分 · 选卡 #1" },
      { i: 3, name: "卷帘 · 公寓隐私", status: "done", plan: "video-plan-03", judge: "评审 7 分 · 选卡 #2" },
      { i: 4, name: "卷帘 · 办公防眩", status: "run", plan: "5 帧抽卡中", judge: "" },
      { i: 5, name: "卷帘 · 客厅柔光", status: "wait", plan: "", judge: "" },
      { i: 6, name: "卷帘 · 转角落地窗", status: "wait", plan: "", judge: "" },
      { i: 7, name: "斑马帘 · 白天隐私", status: "wait", plan: "", judge: "" },
      { i: 8, name: "斑马帘 · 厨房采光", status: "wait", plan: "", judge: "" },
      { i: 9, name: "纱帘 · 客厅 S 褶", status: "wait", plan: "", judge: "" },
      { i: 10, name: "纱帘 · 公寓柔光", status: "wait", plan: "", judge: "" },
    ],
  },
  user: { name: "Evan", mail: "lucas@sunnyshutter.ca", version: "V2.1 · 生产" },
  templates: {
    shade: [
      { id: "roller-glare", name: "卷帘 · 晨光刺眼", sub: "痛点钩子 → 拉帘 → 安睡" },
      { id: "roller-privacy", name: "卷帘 · 公寓隐私", sub: "外窗直视 → 拉帘 → 私密" },
      { id: "zebra-day", name: "斑马帘 · 白天隐私", sub: "透光但不透人" },
      { id: "zebra-kitchen", name: "斑马帘 · 厨房采光", sub: "防眩仍明亮" },
      { id: "sheer-living", name: "纱帘 · 客厅 S 褶", sub: "高级空间质感" },
      { id: "sheer-glow", name: "纱帘 · 公寓柔光", sub: "硬光变柔光" },
    ],
    shutter: [
      { id: "shutter-glare", name: "百叶 · 晨光防眩", sub: "光影穿叶片 → 舒适" },
      { id: "shutter-door", name: "百叶 · 整扇开合", sub: "像门一样打开看风景" },
      { id: "shutter-privacy", name: "百叶 · 夜间隐私", sub: "暖灯 + 关叶片" },
      { id: "shutter-hero", name: "百叶 · 产品英雄墙", sub: "整墙静景 + 硬广 CTA" },
    ],
  },
  refs: ["assets/ref-1.png", "assets/ref-2.png", "assets/ref-3.png", "assets/ref-4.png"],
  thumbPool: ["assets/thumb-01.png", "assets/thumb-02.png", "assets/thumb-03.png", "assets/thumb-04.png"],
  storyboard: [
    { id: "hook", tag: "① 钩子", sub: "刺眼晨光", img: "assets/thumb-01.png", score: "8.5" },
    { id: "conflict", tag: "② 冲突特写", sub: "窗为主体", img: "assets/thumb-01.png", score: "8.0" },
    { id: "operate", tag: "③ 操作", sub: "侧边拉珠", img: "assets/thumb-02.png", score: "8.5" },
    { id: "payoff", tag: "④ 收获", sub: "遮光安睡", img: "assets/thumb-03.png", score: "7.5" },
    { id: "hero", tag: "⑤ 产品定格", sub: "CTA 留白", img: "assets/thumb-04.png", score: "9.0" },
  ],
  library: [
    { id: "ss-01", name: "卷帘 · 晨光刺眼 #1", meta: "15s · Fast VIP · 今天 14:12", img: "assets/thumb-01.png", branded: true },
    { id: "ss-02", name: "卷帘 · 遮光睡眠 #2", meta: "15s · Fast VIP · 今天 15:03", img: "assets/thumb-03.png", branded: false },
    { id: "ss-03", name: "卷帘 · 公寓隐私 #3", meta: "15s · Fast VIP · 今天 15:26", img: "assets/thumb-02.png", branded: false },
    { id: "ss-04", name: "产品英雄定格 · 素材", meta: "15s · Fast VIP · 今天 15:40", img: "assets/thumb-04.png", branded: false },
  ],
};
window.AIVORA_DATA = AIVORA_DATA;
