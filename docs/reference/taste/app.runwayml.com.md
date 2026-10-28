# Design Map

Source: https://app.runwayml.com — guest workspace (no login), three pages: Home (`/ai-tools/generate`), Brand Kits (`/ai-tools/brand`), Apps › Product Shot Video Builder. Captured 2026-10-28 at 1440×900 in both `prefers-color-scheme: light` and `dark`; the app follows the system setting, so a viewer sees whichever their OS uses. Across 3 pages the sidebar, gray ramp, radii and accent are identical (system signals).

## Spacing Scale
- 8px base (64 uses) with 6px (57) a close second — the dense rhythm inside controls
- 4 / 12 / 16 / 20px — between chips, cards and list rows
- 40 / 48px — between the hero line, the prompt card and the gallery

## Font Hierarchy
- One custom family, "Normal" (Runway's own grotesk) — nothing else on the page
- 36px / 400 / −0.36px / 40px line — the single page headline ("What will you create today?")
- 24px / 600 / −0.24px — section titles (Welcome to Brand Kits, Examples of Kits)
- 16px / 500 — card titles
- 14px / 400–600 / 20px line — all UI and body (65 of ~92 text nodes)
- 12px — meta, slot labels (Reference, Sketch)

## Color Palette — dark (the scheme our workspace uses)
- #000000 — page field (level0, 51.6% of the viewport)
- rgba(179,187,255,0.067) over black ≈ #0C0D11 — sidebar, a faint periwinkle tint instead of a border
- #131416 — level1 panels (44%); #121314 — the prompt card; #1B1E23 — level2 / raised
- #2C3037 — active controls (level1-ui)
- 1px rgba(255,255,255,0.05) — card hairline; rgba(116,151,252,0.22) — the one announcement strip's border
- rgba(207,213,255,0.118) — selected nav item fill
- #FFFFFF / #A1AFC5 / #818A9D — text primary / secondary / inactive (a cool blue-gray ramp, not neutral gray)
- #2C22FA with white text — the one primary action (Sign up, dropdown selection)
- #7497FC — links and inline actions (Connect account)

## Color Palette — light
- #FFFFFF page (80.2% of painted area); #F0F2F5 chips and gallery cards (17.9%)
- rgba(0,7,55,0.05) sidebar; #E8EAF0 / #DEE4EC hairlines
- #000000 / #5F6673 / #818A9D text; the same #2C22FA primary

## Gray Ramp (`--rw-gray-*`, shared by both schemes)
#FFF · #F0F2F5 · #E8EAF0 · #DEE4EC · … · #A1AFC5 (100) · #818A9D (120) · #5F6673 (140) · #2C3037 (170) · #1B1E23 (180) · #131416 (190) · #000 (200). Every step leans blue; the dark scheme reads the ramp from the bottom.

## Image Ratios
- Use-case gallery: one 200px-tall row mixing 1:1, 9:16 and 16:9 tiles, radius 8px, label over a bottom scrim
- Brand Kit examples: 1:1 logo tiles on white or brand blue
- How-it-works: three 4:3 stills joined by arrows

## Component Tokens
- Radii: 100px pills (20 uses), 8px (17), 10px (15), 12px (13), 6px (12), 20px strips, 24px the prompt card
- Prompt card: 840×189, radius 24px, 1px 5% white border; Reference / Sketch slots 62px tall inside it; model chips row below (Edit in Timeline · Seedance 2.5 · GPT Image 2), 38px tall, radius 12px
- Shadows: dark — 0 8px 16px rgba(0,0,0,0.5) on floating menus only; light — a three-layer ambient shadow (0 40px 140px rgba(12,62,97,0.05)) under the prompt card
- Motion: layout 0.25s cubic-bezier(0.4,0,0.2,1) (sidebar width, panels); hover 0.12s cubic-bezier(0.2,0,0,1)
- Sidebar: 240px; a Creative / Ads / Dev segmented switch on top, "New Chat" button, then Home · Agent · Tool · Apps · Workflows · Plugins · Brand Kits · More

---

# Taste DNA

### Ask first, pick a model later
- **Trigger**: A creator lands on the workspace with something to make.
- **Decision**: The home is one 840×189 prompt card under a 36px weight-400 question ("What will you create today?"), with Reference and Sketch slots inside the card and model chips *below* it — rejecting a grid of tools or a model picker as the first thing on screen.
- **Reason**: Runway's agent routes intent to the right model; asking the user to choose Seedance vs. GPT Image before they've said what they want front-loads a decision they can't make well.
- **Evidence**: prompt card radius 24px, the only 24px radius on the page; model chips 38px tall at #F0F2F5 / level2; Product Shot Video Builder opens with "Upload your product image — we'll extract a tailored brief for you".

### Cool gray chrome, one electric color
- **Trigger**: The page is full of colorful generated media.
- **Decision**: All chrome comes from one blue-leaning gray ramp (#A1AFC5 / #818A9D text, #131416 / #1B1E23 panels) and a single saturated #2C22FA reserved for the one primary action — rejecting multiple accent colors, colored section headers or tinted panels.
- **Reason**: With thumbnails competing for attention, the frame must recede. A cool cast keeps it from looking like plain gray, and one electric color makes "the next step" unmistakable.
- **Evidence**: #2C22FA appears on exactly two elements (Sign up, dropdown selection); links use the lighter #7497FC so text stays readable on black; zero gradients in the chrome.

### Depth from tinted levels, not borders (Restraint)
- **Trigger**: A dark UI needs a sidebar, panels and floating menus to read as separate.
- **Decision**: Runway stacks named levels (level0 #000 → level1 #131416 → level2 #1B1E23) and tints the sidebar with 6.7% periwinkle instead of drawing a divider line — rejecting a bordered sidebar and stacked card shadows.
- **Reason**: Lines multiply fast in a tool UI; separating planes by luminance keeps the screen quiet and lets the one 5% hairline on cards carry enough edge.
- **Evidence**: `--rw-level0/1/2-bg|div|ui` tokens; sidebar rgba(179,187,255,0.067); card borders rgba(255,255,255,0.05); the only drop shadow in dark mode sits on floating menus.

### Light headline, dense controls
- **Trigger**: A tool page has one headline and many small controls.
- **Decision**: The headline is 36px at weight 400 with −1% tracking; everything else is 14px at 400–600 on an 8 / 6px rhythm — rejecting a bold display headline or roomy 16px controls.
- **Reason**: The weight belongs to the media; the type stays precise and out of the way, and the dense 14px controls fit model chips, slots and tabs in one row.
- **Evidence**: h1 36px/400/40px line; 65 of ~92 text nodes at 14px; spacing distribution led by 8px (64) and 6px (57).
