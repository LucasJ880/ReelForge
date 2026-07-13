# Phase 1 Design System · Verification Record

Date: 2026-07-13 (America/Toronto)

## Implemented

- `/app` uses a scoped dark Studio theme; public authentication pages remain light Editorial.
- Studio shell contains the five primary zones, owner-scoped live counts, workspace control, search, and account control.
- Batch L1 uses the film-count distribution strip. Batch L2 uses 56px virtualized rows with 96×54 thumbnails. Reduced-motion disables the generating animation.
- Library and template surfaces are media-first. Empty states contain one instruction and one direct action.
- IDs, timestamps, progress/cost figures, and version numbers use the mono role on the new Studio surfaces.

## Automated evidence

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm test`: PASS — 633 passed, 1 existing skipped, 0 failed (634 total)
- `tests/studio-design-system.test.ts`: PASS — 6/6
- `tests/storage-migration-candidate-identification.test.ts`: PASS — 2/2
- source color gate: PASS — hexadecimal colors only occur in `src/styles/tokens.css`

WCAG contrast ratios for the Studio tokens:

| Foreground / background | Ratio |
| --- | ---: |
| primary text / canvas | 15.51:1 |
| secondary text / canvas | 6.74:1 |
| secondary text / surface | 6.28:1 |
| accent / canvas | 5.56:1 |
| success / canvas | 6.81:1 |
| warning / canvas | 10.02:1 |
| failure / canvas | 4.97:1 |

All listed text combinations pass WCAG AA for normal text.

## Browser evidence completed

- `login-1440.jpg`
- `login-390.jpg`
- Mobile DOM measurement: viewport content width 375px, document scroll width 375px (no horizontal overflow).
- 五个 `/app` 一级区均完成 `1440.png` 与 `390.png` 截图，共 10 张。
- 演练分支真实数据下五区均成功渲染，浏览器 console error 为 0。
- 390px 五区均无水平溢出；媒体网格的隐式 max-content 列问题已改为显式 `grid-cols-1 + min-w-0` 并加入测试。

## Gate blockers — no claim of completion

Neon 演练分支已成功应用并核验三份迁移：

- `20260713_phase1_customer_role`
- `20260713_phase1_historical_dispatch_quarantine`
- `20260713_phase1_workspace_plans`

完整证据见 `docs/evidence/phase-1/neon-rehearsal-20260713.md`。生产分支尚未应用迁移，仍需人工 Gate。

在数据库 Gate 批准生产迁移前，以下项目仍待完成：

- Lighthouse accessibility score for authenticated Studio screens;
- 生产迁移后的最终统一旅程复验，然后才能按锁定顺序落 308、迁移旧测试与删除旧页面。

The former competitor side-by-side visual check is superseded by Final Sprint constitution F1 (IP isolation). The supplied proprietary UI screenshot and HTML were not read or used as implementation references. Quantitative output-quality comparisons under P1/P2 remain pending until the human side supplies exported comparison videos; those exports may be evaluated as product outputs, not UI source material.
