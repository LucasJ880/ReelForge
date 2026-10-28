# Design Map

Source: https://seed.bytedance.com/en/seedance2_5 — captured 2026-10-28 at 1440×900 (single page; the page scrolls inside `div.container-snRx60`, 5216px tall; hero act is 2 viewports, 1800px).

## Spacing Scale
- 120px — vertical padding between feature sections
- 56px / 48px / 40px — title-to-carousel and carousel-to-next-title gaps
- 32px / 20px / 16px — in-section gaps (title → paragraph → controls)
- 13px — button vertical padding (48px pill)
- 8px — chip and icon gaps
- Left content edge: x = 113px at 1440 width (title, paragraph and first card share it)

## Font Hierarchy
- One family only: **Stack Sans Headline** (322 of 322 sampled text nodes)
- Hero title: 100px / 100px, weight 600, letter-spacing −2px, #FFFFFF on video
- Section title: 32px / 44px, weight 500, #212121
- Body / section sentence: 16px / 20px, weight 400, rgba(33,33,33,0.8), max line width 780px
- Nav + buttons: 16px, weight 400 (nav) / 500 (CTA), letter-spacing 0.32px on nav
- Mode chips + footer headings: 14px, weight 400–500
- Legal: 12px / 18px, rgba(33,33,33,0.5)
- Six sizes total (100 / 32 / 20 / 16 / 14 / 12); weight 600 appears exactly once (the hero title)

## Color Palette
- #18191B — hero field behind the video (55.7% of painted area)
- #F8F8F8 — gallery canvas after the hero (42.7% of painted area)
- #212121 — primary text on light; 80% and 50% alphas for secondary / tertiary
- #FFFFFF — text on video
- rgba(255,255,255,0.20) + blur(12px) — CTA pills on video
- rgba(249,249,251,0.08) → 0.14 — nav pills on video
- rgba(0,0,0,0.45) with rgba(255,255,255,0.85) text — mode chips (T2V / R2V) on media
- #F7F8FA — carousel arrow circles on the light canvas
- No brand accent hue anywhere in the chrome

## Image Ratios
- Hero: full-bleed muted video, 1425×900 at 1440 viewport (source 1280×720), slick carousel of several clips, "Click to unmute" pill centered
- Feature video: 1200×675 (16:9), radius 30px
- Capability carousels: 600px tall cards, 530–1067px wide (0.88:1 → 1.78:1), radius 20px, input panel (Prompt / Reference) beside the output clip
- Showcase: 3-column masonry, mixed portrait and landscape clips, radius 20px

## Component Tokens
- Radii: 999px (pills), 30px (feature video), 20px (media cards), 16px, 4px (chips), 2px
- CTA pill: 48px tall, padding 13px 20px, three equal-width (~234px) buttons in a row
- Glass shadow: `0 8px 32px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.50), inset 0 −1px 0 rgba(255,255,255,0.10)`
- Nav pill: 30px tall, radius 80px
- Carousel arrow: 40px circle, solid #F7F8FA
- Motion: opacity 0.6s cubic-bezier(0.32,0.94,0.6,1); transform 0.8s same curve; transform 1.2s cubic-bezier(0.66,0,0.34,1) with 0.1s stagger; color 0.25s cubic-bezier(0.4,0,0.2,1)
- Gaps in craft: no `:focus-visible` rules and no `prefers-reduced-motion` handling were found

---

# Taste DNA

### Footage is the only pigment
- **Trigger**: The thing being sold is generated video.
- **Decision**: Grayscale chrome — #18191B hero field, #F8F8F8 canvas, #212121 text, every button a white alpha — over a brand accent color in the UI.
- **Reason**: Any saturated UI color sits beside the clips and color-casts them. With no chrome hue, every warm or saturated pixel the visitor notices is model output, so the whole page reads as a demo reel.
- **Evidence**: 55.7% of painted area #18191B and 42.7% #F8F8F8; accent candidates are only #212121, #FCFCFD and white alphas; mode chips are rgba(0,0,0,0.45) rather than a colored badge.

### The hero speaks once, at the bottom
- **Trigger**: The first screen is a moving image.
- **Decision**: One 100px headline, one 16px sentence and three equal pills, all inside the bottom 268px of the frame — rejecting the common centered hero with an eyebrow, bullet benefits, stats or logo badges.
- **Reason**: Copy in the upper 70% of a video frame covers faces and action. Parking it in the lower-left gutter keeps the subject readable and makes the type behave like a film title card instead of an ad banner.
- **Evidence**: content block starts at y=632 and is 268px tall on a 900px viewport; h1 100/100, weight 600, −2px tracking; nothing else above the fold except a 30px nav row; the three CTAs are equal width (~234px), 48px tall.

### Prove with paired clips, not paragraphs
- **Trigger**: Explaining each capability (30s length, reference control, editing, professional production).
- **Decision**: Each section is exactly one 32px title + one 16px sentence (≤780px) + a horizontal carousel of 600px-tall cards that put the input (prompt or reference image) next to the generated clip — rejecting icon grids and multi-paragraph feature copy.
- **Reason**: A visitor trusts a reference image beside its result more than any adjective; the sentence only names the capability and the pair proves it.
- **Evidence**: 4 sections, every one titled 32/500/44 with a single paragraph 16/400/20; cards 530–1067 × 600, radius 20px; "Prompt"/"Reference" panels and 14px T2V/R2V chips sit on the media itself.

### Glass only where something moves behind it
- **Trigger**: Choosing a button material across a dark video act and a light gallery act.
- **Decision**: Translucent blurred pills (white 20%, blur 12px, inset top highlight) only over the hero video; flat solid #F7F8FA circles on the light canvas — instead of one button style everywhere.
- **Reason**: Blur reads as material only when there is motion to blur. On a flat #F8F8F8 field it would be invisible cost, so the page drops it the moment the video ends.
- **Evidence**: hero CTAs rgba(255,255,255,0.2) + backdrop-filter blur(12px) + 0 8px 32px rgba(0,0,0,0.1); nav pills rgba(249,249,251,0.08); carousel arrows 40px solid #F7F8FA with no blur.
