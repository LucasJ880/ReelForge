# Iteration 3.17 — Design-system closure inside the approved topology

Date: 2026-07-14

## Approved topology preserved

- `/app/**`: dark Studio tokens under `.studio-theme`.
- public/auth/internal operations: light Editorial root tokens.
- Showcase/demo: frozen, with no redesign dependency.

An accidental dark override under `.auth-studio-theme` was removed in commit `38dea0f`. The auth class now only declares `color-scheme: light`; the dark workspace tokens remain scoped to `.studio-theme`.

## Automated audit

Command: `npx tsx --test tests/design-system-closure.test.ts`

Result: **3/3 passed**.

- approved theme topology is exact;
- literal DOM colors exist only in `src/styles/tokens.css`;
- font roles and motion values resolve from tokens, declared durations are no more than 300ms, and `prefers-reduced-motion` is present.

The remaining arbitrary layout expressions were reviewed and classified in `qa/evidence/phase34/design-token-exemptions.md`. None declares an independent color, component radius, component shadow, font role, or motion duration.

## Component/font/motion closure

- `next/font` supplies Inter, Instrument Serif, Space Grotesk, JetBrains Mono, Noto Sans SC, and Noto Serif SC; token aliases select the correct surface role and CJK fallback.
- Cost, IDs, counts, timestamps, and progress use the shared mono/tabular roles where exposed in the audited routes.
- Button, Card, Input/Textarea/Select, Badge, Dropzone, and Toast implementations remain centralized under `src/components/ui`.
- Loading/error states use the shared surface/customer/auth boundary primitives and respect reduced motion.
- New dependencies: none; package bundle impact from this closure: 0 bytes.

## Evidence

- Corrected 33-route × 3-width matrix: 99/99 passed.
- Settled screenshots: `qa/screenshots/redesign/phase34-current/`.
- Baseline screenshots: `qa/screenshots/baseline/routes/`.
- Golden after topology repair: `gp-1784043470993-88e292ff`.

Visual quality remains a human gate. This record proves consistency and behavior; it does not self-approve aesthetics.
