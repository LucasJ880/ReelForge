/**
 * 液态玻璃极光背景（含锦鲤游动装饰）。
 * 纯 CSS 动画，无 canvas / JS 循环，移动端也流畅。
 * 必须放在 .aivora-glass 作用域容器内使用。
 */
export function GlassBackground({ koi = true }: { koi?: boolean }) {
  return (
    <div className="lg-aurora" aria-hidden>
      {koi && (
        <>
          <span className="lg-koi">🐟</span>
          <span className="lg-koi koi-2">🐠</span>
        </>
      )}
    </div>
  );
}
