import {
  SIGNOFF_BRAND_MAX,
  SIGNOFF_CTA_MAX,
  signoffGeometry,
  signoffLogoGeometry,
} from "@/lib/video-generation/brand-signoff";

const FRAME = { width: 1080, height: 1920 } as const;

export type SignoffPreviewCopy = {
  title: string;
  hint: string;
  scene: string;
  captions: string;
  empty: string;
  trimmed: string;
};

/**
 * 片尾落款预览（2026-11-10）：品牌页原来只有两列输入框，填完不知道成片上长什么样。
 * 这里按合成器同一套版式（signoffGeometry / signoffLogoGeometry：位置、字号、Logo 白底板的比例）
 * 画一个 9:16 的示意帧——品牌名、行动指引、Logo 一改，预览跟着变。
 *
 * 是示意不是成片：底下是占位的「最后一个镜头」，字体与真实合成同一套（Noto Sans SC），
 * 位置按「字幕在底部」那一档（最常见）。超出落款字数上限的部分和成片一样被截掉，并写明。
 * 纯展示：不发请求，不引服务端模块。
 */
export function SignoffPreview({
  brandName,
  cta,
  logoUrl,
  copy,
}: {
  brandName: string;
  cta: string;
  logoUrl: string;
  copy: SignoffPreviewCopy;
}) {
  const clip = (value: string, max: number) => Array.from(value.trim()).slice(0, max).join("");
  const brand = clip(brandName, SIGNOFF_BRAND_MAX);
  const action = clip(cta, SIGNOFF_CTA_MAX);
  const trimmed = brand !== brandName.trim() || action !== cta.trim();
  const text = signoffGeometry({ ...FRAME, captionPosition: "bottom" });
  const logo = signoffLogoGeometry({ ...FRAME, captionPosition: "bottom", hasCta: Boolean(action) });
  /// 画面尺寸 → 预览里的比例：竖向用百分比，字号 / 内边距用容器宽度单位（预览多宽都按 1080 等比缩）
  const fromBottom = (y: number) => `${((1 - y / FRAME.height) * 100).toFixed(2)}%`;
  const cqw = (px: number) => `${((px / FRAME.width) * 100).toFixed(2)}cqw`;

  return (
    <figure className="flex w-56 max-w-full shrink-0 flex-col gap-2" data-testid="signoff-preview">
      <figcaption className="text-meta font-medium text-muted-foreground">{copy.title}</figcaption>
      <div
        className="relative aspect-[9/16] w-full overflow-hidden rounded-(--radius-lg) border border-border bg-sunken"
        style={{ containerType: "inline-size" }}
        aria-hidden="true"
      >
        <p className="absolute inset-x-3 top-[38%] text-center text-data text-tertiary">{copy.scene}</p>
        {/* 字幕占的位置（落款坐在它上方） */}
        <p
          className="absolute inset-x-0 text-center text-tertiary"
          style={{ bottom: fromBottom(FRAME.height - 150), fontSize: cqw(46) }}
        >
          {copy.captions}
        </p>
        {brand ? (
          <>
            {logoUrl ? (
              <div
                /// 成片里 Logo 垫的就是白底板（品牌 Logo 多半按浅色背景设计），预览照实画
                className="absolute left-1/2 -translate-x-1/2 bg-foreground"
                style={{ bottom: fromBottom(logo.bottomY), padding: cqw(logo.pad) }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt=""
                  className="block object-contain"
                  style={{ maxWidth: cqw(logo.maxWidth), maxHeight: cqw(logo.maxHeight) }}
                />
              </div>
            ) : null}
            <div
              className="absolute left-1/2 flex w-max max-w-[94%] -translate-x-1/2 flex-col items-center text-center text-foreground"
              style={{ bottom: fromBottom(text.y), fontFamily: '"Noto Sans SC", sans-serif' }}
            >
              <span className="bg-(--overlay) leading-none" style={{ fontSize: cqw(text.brandFontSize), padding: cqw(text.padding) }}>
                {brand}
              </span>
              {action ? (
                <span className="bg-(--overlay) leading-none" style={{ fontSize: cqw(text.ctaFontSize), padding: cqw(text.padding) }}>
                  {action}
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      <p className="text-pretty text-data text-tertiary">{brand ? (trimmed ? copy.trimmed : copy.hint) : copy.empty}</p>
    </figure>
  );
}
