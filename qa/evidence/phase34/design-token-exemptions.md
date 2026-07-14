# Phase 3/4 design-token scan exemptions

Date: 2026-07-14

## Enforced zero-tolerance categories

- DOM color literals outside `src/styles/tokens.css`: **0 files**. Locked by `tests/design-system-closure.test.ts`.
- Page/component literal shadows and radii: replaced by the semantic `shadow-editorial` and `rounded-(--radius-*)` bridge.
- Font roles: body, display, Studio display, and mono resolve from `next/font` variables through the token file.
- Motion duration/easing: `--motion-fast`, `--motion-base`, and `--ease-out`; all declared durations are at most 300ms. Global reduced-motion handling removes nonessential animation and transition time.

## Reviewed exemptions

The arbitrary-value scan still finds geometry expressions. They are retained only in the following categories and are not independent palette, typography-role, radius, shadow, or motion declarations:

1. **Responsive layout geometry** — grid track formulas, viewport-height clamps, content-width caps, dialog/sheet safe-area sizing, and media aspect containers. Examples: product-image split panels, auth hero/form tracks, batch wizard side panels, and shared dialog width calculations.
2. **Dense/virtualized data geometry** — batch monitor row height, minimum row width, thumbnail size, and runtime `height`/`transform` values required by the virtualizer. These define table mechanics rather than visual theme spacing.
3. **Intrinsic media geometry** — player max heights, phone/mock device aspect boxes, image preview dimensions, and asset-grid minimum widths. Preview URLs and progress widths remain runtime inline values because they are data, not theme declarations.
4. **Component-library positioning** — inherited radius, tooltip arrow offsets, overlay transforms, safe-area padding, and pressed-scale transforms needed by Base UI/shadcn primitives.
5. **Frozen Showcase/demo geometry** — the Showcase and demo exhibit are explicitly outside the Phase 3/4 redesign scope. Their device mockup dimensions remain isolated under `src/components/demo/**`.

`rounded-full` remains allowed only for semantic circles (avatars, status dots, counters). It is not a competing card/input radius. The single empty-upload illustration is `src/components/editorial/empty-upload-illustration.tsx` and is consumed through the shared Dropzone.

## Shared component authority

- Buttons: `src/components/ui/button.tsx`
- Cards: `src/components/ui/card.tsx`
- Inputs/textareas/selects: `src/components/ui/{input,textarea,select}.tsx`
- Status badges: `src/components/ui/badge.tsx`
- Upload empty state: `src/components/ui/dropzone.tsx` + the single Editorial illustration
- Toasts: the existing `src/components/ui/sonner.tsx`

No dependency was added during the Phase 3/4 closure, so bundle impact is **0 bytes attributable to new packages**.
