/**
 * 配乐曲库（2026-11-10 扩充）：唯一的目录。类型（BgmTrackId）、入参校验、合成器、选择界面、
 * 函数打包清单都从这里取，不再各写一份 "none" | "wholesome"。
 *
 * 原来只有一首（Kevin MacLeod「Wholesome」）。2026-11-10 用 Runway 的生成配乐接口
 *（POST /v1/text_to_music，模型 eleven_music_v2_5）一次性做了 7 首不同气质的纯音乐，每首 32 秒、
 * 统一响度（-18 LUFS）、首尾带淡入淡出，直接放进仓库：出片时不再调用任何接口、没有按条成本。
 * 生成时的提示词都要求「纯器乐、无人声、力度平稳、能垫在口播下面」。
 *
 * 文件放 public/audio/bgm：浏览器能直接试听（previewUrl），合成函数经 next.config 的
 * outputFileTracingIncludes 打包后用 path 读。长于 32 秒的成片由合成器循环播放（-stream_loop）。
 *
 * 纯数据：客户端组件、合成器、独立 runner、测试共用，不引任何运行时依赖。
 */
export const BGM_CATALOG = [
  { id: "none", zh: "不添加音乐", en: "No music", mood: { zh: "", en: "" }, path: null, previewUrl: null, source: null },
  {
    id: "warm-acoustic",
    zh: "温暖木吉他",
    en: "Warm acoustic",
    mood: { zh: "木吉他加钢琴，温和、日常", en: "Acoustic guitar and piano — gentle, everyday" },
    path: "public/audio/bgm/warm-acoustic.mp3",
    previewUrl: "/audio/bgm/warm-acoustic.mp3",
    source: "aivora",
  },
  {
    id: "upbeat-pop",
    zh: "轻快流行",
    en: "Upbeat pop",
    mood: { zh: "拍手加合成器，有活力", en: "Claps and synths — energetic" },
    path: "public/audio/bgm/upbeat-pop.mp3",
    previewUrl: "/audio/bgm/upbeat-pop.mp3",
    source: "aivora",
  },
  {
    id: "calm-ambient",
    zh: "安静氛围",
    en: "Calm ambient",
    mood: { zh: "铺底音色加零星钢琴，干净、舒缓", en: "Pads and sparse piano — clean, soothing" },
    path: "public/audio/bgm/calm-ambient.mp3",
    previewUrl: "/audio/bgm/calm-ambient.mp3",
    source: "aivora",
  },
  {
    id: "lofi-chill",
    zh: "松弛 Lo-fi",
    en: "Lo-fi chill",
    mood: { zh: "电钢琴加慵懒鼓点，松弛、居家", en: "Electric piano and soft drums — relaxed, cozy" },
    path: "public/audio/bgm/lofi-chill.mp3",
    previewUrl: "/audio/bgm/lofi-chill.mp3",
    source: "aivora",
  },
  {
    id: "elegant-strings",
    zh: "优雅钢琴弦乐",
    en: "Elegant piano & strings",
    mood: { zh: "钢琴加弦乐，精致、有质感", en: "Piano and strings — refined, premium" },
    path: "public/audio/bgm/elegant-strings.mp3",
    previewUrl: "/audio/bgm/elegant-strings.mp3",
    source: "aivora",
  },
  {
    id: "playful-light",
    zh: "俏皮轻松",
    en: "Playful",
    mood: { zh: "尤克里里加马林巴，可爱、适合萌宠和亲子", en: "Ukulele and marimba — cute, good for pets and kids" },
    path: "public/audio/bgm/playful-light.mp3",
    previewUrl: "/audio/bgm/playful-light.mp3",
    source: "aivora",
  },
  {
    id: "modern-pulse",
    zh: "现代电子",
    en: "Modern electronic",
    mood: { zh: "脉冲低音加干净的琶音，利落、适合数码", en: "Pulsing bass and clean arps — sleek, good for tech" },
    path: "public/audio/bgm/modern-pulse.mp3",
    previewUrl: "/audio/bgm/modern-pulse.mp3",
    source: "aivora",
  },
  {
    /// 最早的那一首：CC BY 4.0，需要署名（见 bgm-attribution）。保留，旧成片与旧快照照常能用。
    id: "wholesome",
    zh: "温馨日常（Kevin MacLeod）",
    en: "Wholesome — Kevin MacLeod",
    mood: { zh: "轻快的日常小调；发布时需要署名", en: "A light everyday tune; needs a credit when you publish" },
    path: "scripts/assets/pet-kit-bgm.mp3",
    previewUrl: null,
    source: "cc-by",
    title: "Wholesome",
    author: "Kevin MacLeod",
    license: "CC BY 4.0",
  },
] as const;

export type BgmCatalogEntry = (typeof BGM_CATALOG)[number];
export type BgmTrackId = BgmCatalogEntry["id"];

/** z.enum 用：至少一个元素的元组。 */
export const BGM_TRACK_IDS = BGM_CATALOG.map((track) => track.id) as unknown as readonly [BgmTrackId, ...BgmTrackId[]];

const TRACK_ID_SET: ReadonlySet<string> = new Set(BGM_TRACK_IDS);

export function isBgmTrackId(value: unknown): value is BgmTrackId {
  return typeof value === "string" && TRACK_ID_SET.has(value);
}

/** 合成函数要随包带上的配乐文件（next.config 的 outputFileTracingIncludes 用）。 */
export const BGM_BUNDLE_FILES: readonly string[] = BGM_CATALOG.flatMap((track) => (track.path ? [`./${track.path}`] : []));
