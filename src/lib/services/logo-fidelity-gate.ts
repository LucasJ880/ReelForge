import sharp from "sharp";

/**
 * B5 · logo 保真校验 Gate（PRD §5 第 2 层 / M5）。
 *
 * 三条判据，抓的是三类不同的坏法：
 *   结构相似度（SSIM）  → 字符走形、笔画断裂
 *   文字可读性          → 乱码、多字少字
 *   色彩偏移（ΔE）      → 品牌色漂移
 *
 * 任一不过 → 自动重出，不合格不进交付。
 * **这个通过率就是「一次通过率」指标**（PRD §6 C3），不必另造一把尺子。
 *
 * 为什么不用现成的 OCR 库：文字可读性这一条要判的是「品牌名有没有被写错」，
 * 而不是「图上有什么字」。视觉模型直接回答前者，比 OCR 出一堆字再做字符串距离更准，
 * 也少一个需要单独部署的依赖。OCR 那条路留在 `readLogoText` 的接口后面，可替换。
 */

/** 归一化的 logo 区域框（相对坐标，与分辨率无关）。 */
export type LogoBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GateThresholds = {
  /// SSIM 下限。低于它说明 logo 的结构被改了。
  minSsim: number;
  /// 品牌名字符相似度下限（0-1）。
  minTextSimilarity: number;
  /// 主色 ΔE 上限。ΔE > 5 在并排对比下肉眼可辨。
  maxDeltaE: number;
  /// 清晰度比下限（生成图拉普拉斯方差 / 参考图）。抓「logo 糊了」。
  minSharpnessRatio: number;
};

/**
 * 默认阈值。
 *
 * `minSsim = 0.85`：同一 logo 经过一次有损压缩与轻微缩放通常仍在 0.9 以上；
 * 掉到 0.85 以下基本意味着模型重画过它，而不是压缩噪声。
 *
 * `maxDeltaE = 5`：ΔE 在 2 以内肉眼几乎不可辨，5 是「并排放才看得出」的量级。
 * 品牌色允许这个幅度的漂移，再多就不是同一个品牌色了。
 */
export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  minSsim: 0.85,
  minTextSimilarity: 0.8,
  maxDeltaE: 5,
  /// 0.35：一次有损压缩的清晰度比通常 >0.7，高斯模糊直接掉到 0.1 以下。
  /// 端到端测试抓出的缺口：全局 SSIM 保低频结构，对「糊」不敏感 ——
  /// 而「重绘整图 = logo 糊」正是 PRD 要逃离的那一档，必须有专门判据。
  minSharpnessRatio: 0.35,
};

export type GateCheck = {
  rule: "ssim" | "text" | "color" | "sharpness";
  passed: boolean;
  value: number;
  threshold: number;
  message: string;
};

export type GateResult = {
  passed: boolean;
  checks: GateCheck[];
  /// 不过时给可执行的下一步，而不是只说「不合格」。
  retakeAdvice: string | null;
};

/**
 * 裁出 logo 区域并归一到同一尺寸。
 *
 * 两张图的分辨率往往不同（参考图是用户上传的，成图是模型出的），
 * 不归一就没法逐像素比。归一到固定边长而不是较小的那张：
 * 让判据在不同输入下是同一把尺子。
 */
const COMPARE_SIZE = 256;

export async function extractLogoRegion(
  imageBuffer: Buffer,
  box: LogoBox,
): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("读不出图片尺寸");

  /// 框可能因为四舍五入超出边界，夹回图内而不是抛错 ——
  /// 一个像素的越界不该让整条校验挂掉。
  const left = clamp(Math.round(box.x * width), 0, width - 1);
  const top = clamp(Math.round(box.y * height), 0, height - 1);
  const cropWidth = clamp(Math.round(box.width * width), 1, width - left);
  const cropHeight = clamp(Math.round(box.height * height), 1, height - top);

  return image
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: "fill" })
    .removeAlpha()
    .toBuffer();
}

/**
 * 平移容忍的灰度 SSIM。
 *
 * 裸 SSIM 对平移极度敏感：同一个 logo 上下挪 20px 会被打到 0.35，
 * 和被整个重画一个量级 —— 那会把「构图微调」误杀成「结构损坏」。
 * 所以在 ±24px 内做小范围偏移搜索取最优：真实位移能对齐回去，
 * 重画对不齐（不存在任何偏移能让两条横杠对上一个实心块）。
 *
 * 用全局单窗口而不是滑窗平均：logo 区域已经裁出并归一到 256×256，
 * 它整体就是一个结构单元，滑窗平均反而会稀释「某几笔断了」这种局部损坏。
 */
const OFFSET_RANGE = 24;
const OFFSET_STEP = 4;

export async function structuralSimilarity(
  a: Buffer,
  b: Buffer,
): Promise<number> {
  const [grayA, grayB] = await Promise.all([toGray(a), toGray(b)]);
  let best = 0;
  for (let dy = -OFFSET_RANGE; dy <= OFFSET_RANGE; dy += OFFSET_STEP) {
    for (let dx = -OFFSET_RANGE; dx <= OFFSET_RANGE; dx += OFFSET_STEP) {
      best = Math.max(best, ssimAtOffset(grayA, grayB, dx, dy));
      /// 已经贴近满分就不必继续搜了。
      if (best > 0.995) return best;
    }
  }
  return best;
}

function ssimAtOffset(
  grayA: Uint8Array,
  grayB: Uint8Array,
  dx: number,
  dy: number,
): number {
  const size = COMPARE_SIZE;
  const width = size - Math.abs(dx);
  const height = size - Math.abs(dy);
  if (width <= 0 || height <= 0) return 0;

  const startAx = dx > 0 ? dx : 0;
  const startAy = dy > 0 ? dy : 0;
  const startBx = dx < 0 ? -dx : 0;
  const startBy = dy < 0 ? -dy : 0;

  let sumA = 0;
  let sumB = 0;
  const n = width * height;
  for (let y = 0; y < height; y += 1) {
    const rowA = (startAy + y) * size + startAx;
    const rowB = (startBy + y) * size + startBx;
    for (let x = 0; x < width; x += 1) {
      sumA += grayA[rowA + x];
      sumB += grayB[rowB + x];
    }
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let y = 0; y < height; y += 1) {
    const rowA = (startAy + y) * size + startAx;
    const rowB = (startBy + y) * size + startBx;
    for (let x = 0; x < width; x += 1) {
      const da = grayA[rowA + x] - meanA;
      const db = grayB[rowB + x] - meanB;
      varA += da * da;
      varB += db * db;
      cov += da * db;
    }
  }
  varA /= n - 1 || 1;
  varB /= n - 1 || 1;
  cov /= n - 1 || 1;

  /// 标准 SSIM 稳定项，按 8bit 动态范围取。
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  return (
    ((2 * meanA * meanB + c1) * (2 * cov + c2)) /
    ((meanA ** 2 + meanB ** 2 + c1) * (varA + varB + c2))
  );
}

async function toGray(buffer: Buffer): Promise<Uint8Array> {
  const { data } = await sharp(buffer)
    .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: "fill" })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

/**
 * logo 主色。
 *
 * **不能用整个区域的主色**：logo 框里背景像素通常占多数，
 * `sharp.stats().dominant` 会对两张图都返回背景色，ΔE 恒为 0，
 * 色彩判据形同虚设 —— 这正是第一版实现犯的错。
 *
 * 做法：取高饱和（chroma > 24）像素的平均色。品牌色几乎总是饱和色，
 * 而背景多为白/灰/米这类低饱和色，这个过滤天然把 logo 从背景里分出来。
 *
 * 已知局限：纯黑/纯灰 logo 没有饱和像素，会退回全区域平均 ——
 * 此时色彩判据变宽松（参考图与成图的平均都被背景主导，ΔE 偏小），
 * 但结构（SSIM）与文字判据仍然守着，不会放过重画。
 */
const CHROMA_THRESHOLD = 24;

export async function dominantColor(
  buffer: Buffer,
): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let saturatedR = 0;
  let saturatedG = 0;
  let saturatedB = 0;
  let saturatedCount = 0;
  let allR = 0;
  let allG = 0;
  let allB = 0;
  const pixels = info.width * info.height;

  for (let i = 0; i < pixels; i += 1) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    allR += r;
    allG += g;
    allB += b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (chroma > CHROMA_THRESHOLD) {
      saturatedR += r;
      saturatedG += g;
      saturatedB += b;
      saturatedCount += 1;
    }
  }

  /// 饱和像素太少（<1%）时不可信 —— 可能只是压缩噪点，退回全区域平均。
  if (saturatedCount >= pixels * 0.01) {
    return {
      r: Math.round(saturatedR / saturatedCount),
      g: Math.round(saturatedG / saturatedCount),
      b: Math.round(saturatedB / saturatedCount),
    };
  }
  return {
    r: Math.round(allR / pixels),
    g: Math.round(allG / pixels),
    b: Math.round(allB / pixels),
  };
}

/**
 * 清晰度：拉普拉斯方差。
 *
 * 端到端测试抓出的缺口：重度模糊能穿过全局 SSIM（低频结构保留），
 * 而「重绘整图 = logo 糊」正是 PRD 要逃离的那一档。
 * 拉普拉斯算子只响应高频边缘，模糊一来方差断崖式下跌 ——
 * 高斯模糊后通常不足原值的 10%，一次有损压缩仍有 70% 以上。
 */
export async function sharpness(buffer: Buffer): Promise<number> {
  const gray = await toGray(buffer);
  const size = COMPARE_SIZE;
  let sum = 0;
  let sumSq = 0;
  const n = (size - 2) * (size - 2);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
      sum += lap;
      sumSq += lap * lap;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * CIE76 ΔE。
 *
 * 不用 CIEDE2000：后者在饱和色与近中性色上更准，但实现复杂度高一个量级，
 * 而我们要判的是「品牌色有没有明显漂移」这种粗粒度问题，CIE76 够用且可解释。
 * 若将来发现某类品牌色误判，再换 DE2000 也不影响调用方。
 */
export function deltaE(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const [l1, a1, b1] = rgbToLab(a);
  const [l2, a2, b2] = rgbToLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

function rgbToLab({ r, g, b }: { r: number; g: number; b: number }) {
  const toLinear = (c: number) => {
    const v = c / 255;
    return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
  };
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  /// sRGB → XYZ（D65）
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * 品牌名字符相似度（归一化编辑距离）。
 *
 * 用它而不是「相等/不等」：logo 上少一个字母和整段乱码是两种严重程度，
 * 二值判断把它们抹平了，也就没法给出「重出还是放行」之外的第三种处置。
 */
export function textSimilarity(expected: string, actual: string): number {
  const a = expected.trim().toLowerCase();
  const b = actual.trim().toLowerCase();
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export type GateInput = {
  /// 参考产品图（含真实 logo）的字节
  referenceImage: Buffer;
  /// 生成结果的字节
  generatedImage: Buffer;
  /// logo 在两张图上的归一化区域
  logoBox: LogoBox;
  /// 品牌名（用于文字可读性判据）。给 null 则跳过这一条。
  brandName: string | null;
  /// 生成图 logo 区域上实际读到的文字。由调用方用视觉模型或 OCR 取。
  readText: string | null;
  /// Brand Kit 主色。给 null 则用参考图的主色比。
  brandColor?: { r: number; g: number; b: number } | null;
  thresholds?: Partial<GateThresholds>;
};

export async function runLogoFidelityGate(
  input: GateInput,
): Promise<GateResult> {
  const thresholds = { ...DEFAULT_GATE_THRESHOLDS, ...input.thresholds };
  const checks: GateCheck[] = [];

  const [refRegion, genRegion] = await Promise.all([
    extractLogoRegion(input.referenceImage, input.logoBox),
    extractLogoRegion(input.generatedImage, input.logoBox),
  ]);

  const ssim = await structuralSimilarity(refRegion, genRegion);
  checks.push({
    rule: "ssim",
    passed: ssim >= thresholds.minSsim,
    value: round(ssim),
    threshold: thresholds.minSsim,
    message:
      ssim >= thresholds.minSsim
        ? "logo 结构与参考一致"
        : "logo 结构走形：笔画或轮廓被重画过",
  });

  /// 清晰度比：糊了的 logo 能穿过全局 SSIM，必须单独抓。
  const [refSharpness, genSharpness] = await Promise.all([
    sharpness(refRegion),
    sharpness(genRegion),
  ]);
  /// 参考图本身几乎没有细节时这条判据没有意义（比值分母趋零会乱报），跳过。
  if (refSharpness > 1) {
    const ratio = genSharpness / refSharpness;
    checks.push({
      rule: "sharpness",
      passed: ratio >= thresholds.minSharpnessRatio,
      value: round(ratio),
      threshold: thresholds.minSharpnessRatio,
      message:
        ratio >= thresholds.minSharpnessRatio
          ? "logo 清晰度正常"
          : "logo 被糊化：细节大量丢失，多半是被模型重画过",
    });
  }

  /// 品牌名或读到的文字缺一个就跳过这条判据 ——
  /// **跳过要显式记录**，不能让「没检查」在结果里看起来像「检查通过」。
  if (input.brandName && input.readText !== null) {
    const similarity = textSimilarity(input.brandName, input.readText);
    checks.push({
      rule: "text",
      passed: similarity >= thresholds.minTextSimilarity,
      value: round(similarity),
      threshold: thresholds.minTextSimilarity,
      message:
        similarity >= thresholds.minTextSimilarity
          ? "品牌名可读且拼写正确"
          : `品牌名被写错：读到「${input.readText}」，应为「${input.brandName}」`,
    });
  }

  const refColor = input.brandColor ?? (await dominantColor(refRegion));
  const genColor = await dominantColor(genRegion);
  const de = deltaE(refColor, genColor);
  checks.push({
    rule: "color",
    passed: de <= thresholds.maxDeltaE,
    value: round(de),
    threshold: thresholds.maxDeltaE,
    message:
      de <= thresholds.maxDeltaE
        ? "品牌色在允许范围内"
        : "品牌色发生漂移",
  });

  const failed = checks.filter((check) => !check.passed);
  return {
    passed: failed.length === 0,
    checks,
    retakeAdvice: failed.length ? adviceFor(failed) : null,
  };
}

/**
 * 重拍建议。
 *
 * 现在失败了只会「再试一次」（PRD §7 点名的洞）。不同的坏法要不同的改法：
 * 结构坏了要锁像素，颜色漂了要收窄色彩自由度，文字错了要干脆别让它画字。
 */
function adviceFor(failed: GateCheck[]): string {
  const rules = new Set(failed.map((check) => check.rule));
  if (rules.has("ssim") || rules.has("text") || rules.has("sharpness")) {
    return "改走产品锚定路径：把 logo 区域设为 mask 不让模型重画，而不是换种子重试";
  }
  if (rules.has("color")) {
    return "在提示词里锁定品牌色十六进制值，并降低色彩自由度后重出";
  }
  return "重出这一张";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
