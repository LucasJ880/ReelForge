/**
 * 确定性贴印 CLI —— 把品牌 lockup 按像素贴到产品静帧上（不经过生成模型）。
 *
 * 用法：
 *   npx tsx scripts/imprint-logo-composite.ts \
 *     --base=<静帧路径> --lockup=assets/sunnyshutter/lockup-horizontal.png \
 *     --out=<输出路径> --cx=1172 --cy=2514 --w=170 \
 *     [--opacity=0.92] \
 *     [--patch=coverL,coverT,coverW,coverH,fromL,fromT]   # 先清场旧字标
 *
 * patch 的 from 取样区尺寸自动与 cover 一致（同材质同光带取干净条）。
 */
import { imprintLogoOnStill } from "@/lib/video-generation/logo-imprint-compositor";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const base = arg("base");
  const lockup = arg("lockup") ?? "assets/sunnyshutter/lockup-horizontal.png";
  const out = arg("out");
  const cx = Number(arg("cx"));
  const cy = Number(arg("cy"));
  const w = Number(arg("w"));
  if (!base || !out || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(w)) {
    console.error("required: --base --out --cx --cy --w （见文件头注释）");
    process.exit(1);
  }
  const patchRaw = arg("patch");
  const patch = patchRaw
    ? (() => {
        const [coverL, coverT, coverW, coverH, fromL, fromT] = patchRaw
          .split(",")
          .map(Number);
        return {
          cover: { left: coverL, top: coverT, width: coverW, height: coverH },
          from: { left: fromL, top: fromT, width: coverW, height: coverH },
        };
      })()
    : undefined;

  const output = await imprintLogoOnStill({
    basePath: base,
    lockupPath: lockup,
    outputPath: out,
    dest: { centerX: cx, centerY: cy, width: w },
    opacity: arg("opacity") ? Number(arg("opacity")) : undefined,
    patch,
  });
  console.log("imprinted →", output);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
