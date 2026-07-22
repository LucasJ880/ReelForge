# Shuyu Image and Video Workflows Design

Date: 2026-07-22
Status: Approved for implementation
Scope: Customer-facing image generation, single-video generation, batch-video generation, storyboard visibility, optional brand packaging, and Shuyu-only model routing

## 1. Outcome

ReelForge will expose two distinct creation workflows:

1. **AI Image**: optionally upload a reference image, describe the desired result, choose an audited Shuyu Image 2 plan and output settings, then generate image variations.
2. **AI Video**: upload one or more product images, generate and review a visible Shuyu Image 2 storyboard, generate the final video through Shuyu, and optionally apply a workspace brand package containing a logo and end card.

The interface must show the real durable processing state. It must not display a storyboard stage that exists only in the browser, claim a model that was not used, or show a task as ready before required branding has finished.

## 2. Confirmed Product Decisions

- All generative model calls in the public image and video workflows go through Shuyu.
- Direct OpenAI, BytePlus, and Volcengine generation choices are removed from customer-facing creation screens. Historical route snapshots remain readable for old jobs, and mock routes remain available only in non-production test environments.
- Image uploads in image and video creation do not use platform-side AI content review.
- Uploads retain authentication, file-size, declared MIME, magic-byte, storage-quota, ownership, and bounded-fetch protections.
- AI Image and AI Video are separate routes and task types. One can hand a generated image into the other, but their forms and state machines do not overlap.
- A 15-second video uses 3–5 storyboard frames; the default is 4.
- A single-video task pauses after storyboard generation and requires customer approval before video dispatch.
- Batch tasks auto-approve a successfully generated storyboard by default so the queue can continue unattended. A customer can inspect any item and regenerate its storyboard before video dispatch if the item has not advanced.
- Brand packaging is optional per task. Disabling it must produce and expose the clean video without a logo or end card.
- A workspace can maintain a versioned brand package. SunnyShutter is one workspace preset, not a global hard-coded client.

## 3. Approaches Considered

### A. Incremental durable orchestration — selected

Add durable image, storyboard, and brand-package stages around the existing `ProductImageJob`, `VideoBrief`, `BatchJob`, and `VideoJob` foundations. Share provider and UI components between single and batch flows.

Benefits:

- Preserves working video polling, batch leases, route snapshots, and recovery logic.
- Makes every new UI stage correspond to persisted backend state.
- Reduces migration risk and supports focused regression tests.

Costs:

- Requires adapters around existing single and batch services.
- Some legacy naming remains until a later cleanup.

### B. Replace everything with a universal `ProductionRun`

Create one generalized workflow engine for images, storyboards, videos, and packaging.

Benefits: conceptually clean long-term model.

Costs: rewrites working queues, polling, recovery, and task history; too risky for this delivery.

### C. Frontend-only workflow facade

Keep current backend dispatch behavior and simulate storyboard stages in the UI.

Benefits: fastest visual change.

Costs: misrepresents actual work, cannot safely retry, and fails the requirement that users understand what is really happening. Rejected.

## 4. Navigation and Information Architecture

The existing creation mode tabs remain the top-level switch:

- `/app/create/images`: AI Image
- `/app/create`: Single AI Video
- `/app/batches/new`: Batch AI Video

The global navigation labels and page headers use customer language rather than provider terminology. Shuyu and the exact plan appear in a compact task-details row, not as a route selector.

All screens continue using the current Studio shell, semantic tokens, typography, cards, buttons, dialogs, and responsive breakpoints. No new visual language is introduced.

## 5. AI Image Workflow

### 5.1 Main screen

The current image route is simplified into one primary workbench:

- Optional reference-image upload at the top. Dropping any supported JPEG, PNG, or WebP starts upload immediately.
- One natural-language prompt field.
- Compact settings for aspect ratio, resolution, and result count.
- Shuyu Image 2 selector listing only audited, currently available Image 2 plans. If one plan is available, it is shown as a locked informational field instead of a redundant selector.
- Preset/style controls move into a collapsed Advanced section.
- Primary action: `Generate images`.

The old `GENERATE` versus `OPTIMIZE` mode split is removed from the first decision. Supplying a reference image naturally means image-to-image; omitting it means text-to-image.

### 5.2 Results

Results appear in a responsive 1–4 image grid and are saved to history automatically. Each result supports:

- Download
- Generate variations
- Continue editing with a new prompt
- Use for single video
- Add to a batch video

The result card shows the actual Shuyu plan, resolution, status, and points after completion. It never labels a fallback model as Image 2.

### 5.3 State and failures

Image jobs are asynchronous and durable:

`UPLOADING → QUEUED → GENERATING → READY | FAILED`

Upload success is independent of provider availability. A Shuyu failure preserves the uploaded reference, prompt, and settings so the customer can retry without uploading again. Retries reuse a stable request identity and do not create duplicate provider charges after acknowledgement loss.

ReelForge does not add an AI moderation call before generation. If Shuyu itself refuses a prompt or input under its provider policy, the job records that provider response and lets the customer revise the request without losing the uploaded asset.

## 6. Single AI Video Workflow

### 6.1 Visible stage rail

The page displays a persistent stage rail backed by server state:

1. Product images
2. Image 2 storyboard
3. Shuyu video
4. Brand package (optional)
5. Ready

The creation form no longer exposes route selection. Product and reference uploads are accepted as soon as their basic file checks pass.

### 6.2 Storyboard

For a 15-second video, the system generates four timeline frames by default, with policy support for three to five. Each card displays:

- Frame image
- Timeline position and intended duration
- Short scene description
- Product-consistency indicator
- Generation status and retry action

Frames are generated through an audited Shuyu Image 2 plan. Selected storyboard images become the authoritative visual anchors for Shuyu image-to-video submission. Product images remain attached as references within the provider limit.

Once all frames are ready, the task pauses at `AWAITING_STORYBOARD_APPROVAL`. The customer can approve the complete storyboard or regenerate an individual frame. Approving creates the immutable storyboard snapshot used by video generation.

### 6.3 Brand package

Before storyboard generation, the customer sees a single optional control:

`Apply <workspace brand package> logo and end card`

When enabled, a compact preview shows the selected logo, end-card thumbnail, and package name. Advanced fields are managed in workspace settings rather than re-entered for every video.

The request stores both `brandPackageEnabled` and the selected package version. `false` is authoritative and must never be coerced to an automatic ending.

### 6.4 Generation and delivery

After approval:

`STORYBOARD_APPROVED → VIDEO_QUEUED → VIDEO_GENERATING → ASSEMBLING → BRANDING (if enabled) → READY`

The clean provider output is retained internally. The customer-facing result is:

- Clean output when branding is disabled.
- Deterministically composed logo overlay plus end card when branding is enabled.

Logo placement and end-card rendering use local deterministic media processing, not a generative image model.

## 7. Batch AI Video Workflow

### 7.1 Creation

Batch creation keeps the short wizard but adds a final brand-package choice. Each submitted group receives its own stable idempotency identity; retrying a partially submitted mixed batch cannot duplicate successful groups.

The review step clearly states:

- Number of product inputs
- Outputs per product
- Four Image 2 storyboard frames per 15-second output by default
- Shuyu video plan
- Optional brand package
- Estimated points before submission

### 7.2 Monitor

The monitor groups work by durable stage rather than only final status:

- Preparing assets
- Generating storyboards
- Generating videos
- Packaging
- Ready
- Needs attention

Each virtualized job row shows the product thumbnail, a compact 3–5 frame storyboard strip, current stage, progress, and final thumbnail when ready.

Storyboards auto-approve for batch throughput. Before a job begins video generation, the customer can open it and regenerate a frame. Once video submission is acknowledged, the storyboard becomes read-only for that attempt.

### 7.3 Responsive detail inspector

The existing full-width desktop bottom sheet is replaced with a shared responsive inspector:

- Mobile: bounded bottom sheet with internal scrolling.
- Desktop: right-side panel or centered dialog with a maximum width around 640 px.

The video player uses intrinsic media dimensions, `object-contain`, a viewport-bounded maximum height, and visible controls. Portrait, landscape, and square media never expand beyond the inspector or crop to a forced ratio.

The same `VideoPlayerFrame` and detail content are reused by batch and single-video pages.

## 8. Provider and Routing Contract

### 8.1 Audited Shuyu catalog

A server-side Shuyu catalog service reads the live price/plan response and maps audited plan IDs to explicit capabilities:

- Image 2 generation/editing
- Supported resolutions
- Reference-image limits
- Video generation
- Aspect ratios and durations
- Point cost

Only audited Shuyu Image 2 plans may satisfy the Image 2 requirement. If no audited Image 2 plan is currently available, the task fails clearly before charging. It must not silently substitute Gemini, Nano Banana, OpenAI, BytePlus, or Volcengine.

Every provider task persists plan ID, model, resolution, advertised price, request key, external task ID, and final charged/refunded points when available.

### 8.2 Customer routing

New production image and video tasks always route to Shuyu. Direct historical adapters stay registered only so existing jobs can be reconciled. Customer APIs reject attempts to select a direct provider route.

Any optional prompt enhancement or scene planning must either use an audited Shuyu capability or deterministic application templates. Public creation flows must not call another model provider indirectly.

## 9. Persistence Boundaries

### 9.1 Media asset

Introduce a server-owned media asset record containing owner/workspace, storage key, MIME, size, hash, dimensions, and public delivery URL. Creation APIs accept asset IDs and resolve ownership server-side instead of trusting arbitrary external URLs.

No AI-review state is required for image/video creation uploads. Existing content-review integration is removed from these upload endpoints without weakening basic file and ownership checks.

### 9.2 Storyboard run

Persist a storyboard run linked to either a single `VideoBrief` or a batch `VideoJob`:

- Status and approval policy
- Ordered frame records
- Prompt and product-reference snapshot
- Shuyu plan/model/request/task snapshots
- Selected outputs and regeneration attempts
- Approval actor and timestamp
- Failure/recovery information

### 9.3 Workspace brand package

Persist versioned brand packages with logo asset, optional end-card still, contact text, CTA, placement, colors, tail trim, and enabled defaults. Every video task stores an immutable package snapshot, not only a mutable foreign key.

SunnyShutter becomes seeded workspace data using this model. No public component hard-codes `sunnyshutter`.

### 9.4 Events and points

Persist generation events for provider submission, polling transitions, retries, assembly, branding, and refunds. Reserve estimated points before dispatch and reconcile actual/refunded points afterwards. Storyboard candidates and multi-segment videos are included in the estimate.

## 10. Error Handling and Recovery

- Upload failure: identify the exact file and allow retry without clearing other successful uploads.
- Shuyu catalog unavailable: keep the draft and show that current plans could not be verified; do not guess a plan.
- Storyboard partial failure: preserve successful frames and retry only failed frames.
- Storyboard regeneration: replace only the selected frame and invalidate prior approval.
- Video acknowledgement uncertainty: recover through the stable request key before submitting again.
- Provider failure/refund: expose a useful status and reconcile points.
- Branding failure: preserve the clean video, mark packaging as retryable, and do not falsely label the branded deliverable ready.
- Batch mixed failure: successful groups remain submitted; retry resumes only unsent groups.
- Polling loss or reload: every screen reconstructs current state from the server rather than browser-only state.

## 11. Component Boundaries

- `MediaAssetUploader`: reliable uploads, per-file progress, retry, and asset IDs.
- `ShuyuPlanSummary`: verified plan/model/resolution/points display.
- `ImageCreationWorkbench`: prompt, optional reference, compact settings, and result grid.
- `WorkflowStageRail`: shared durable stage visualization.
- `StoryboardPanel` and `StoryboardFrameCard`: single and batch storyboard display/actions.
- `BrandPackageControl`: optional task-level brand selection and preview.
- `VideoPlayerFrame`: intrinsic ratio and bounded playback.
- `ResponsiveVideoDetailOverlay`: mobile sheet and desktop inspector.
- `BatchJobRow` and `BatchJobInspector`: virtualized overview and detailed recovery.

These components use current Studio tokens and existing accessible UI primitives.

## 12. Accessibility and Responsive Requirements

- All stages expose text labels in addition to color.
- Progress updates use appropriate live regions without announcing every poll.
- Upload controls and storyboard actions are keyboard reachable.
- Dialogs/sheets trap focus, restore focus to the triggering job, and close with Escape.
- Images have meaningful task-specific alt text; decorative thumbnails are ignored.
- Reduced-motion preferences disable nonessential progress animation.
- No horizontal page overflow at supported mobile and desktop widths.
- Video controls remain visible and usable for portrait, landscape, and square outputs.

## 13. Test and Acceptance Plan

### 13.1 Unit and service tests

- Upload succeeds when AI content review is unavailable because these endpoints no longer call it.
- MIME, magic-byte, size, quota, ownership, and bounded-fetch checks still reject invalid inputs.
- Shuyu-only routing rejects direct customer provider overrides.
- Image 2 plan audit fails closed rather than substituting another model.
- `shuyu_image2` storyboard artifacts serialize and parse round-trip.
- Storyboard partial retry, individual regeneration, approval invalidation, and idempotency.
- Single approval gate prevents video dispatch before approval.
- Batch auto-approval advances eligible jobs while preserving inspection/retry rules.
- Disabled brand packaging yields a clean output; enabled packaging uses the correct workspace snapshot.
- Designed end cards do not receive a duplicate logo.
- Mixed-batch partial retry does not duplicate successful groups.
- Shuyu submit and poll timeouts retain their separate configured values.

### 13.2 Browser regression

Use the repository's supported browser test setup and realistic provider mocks to simulate:

1. Text-to-image generation through Shuyu Image 2.
2. Reference-image upload, generation, variation, download, and handoff to video.
3. Single-video upload, four-frame storyboard, one-frame regeneration, approval, Shuyu generation, clean delivery.
4. The same single path with workspace branding enabled.
5. Batch upload, auto-approved storyboards, mixed progress, one retryable item, final delivery.
6. Batch item inspection on desktop and mobile for portrait, landscape, and square videos.
7. Reload and reconnect during every durable stage.
8. First-run onboarding dismissal so overlays cannot hide the tested controls.

### 13.3 Visual QA

Capture the same states and viewports as the supplied screenshots, then compare them side by side with the implementation:

- Single creation form and visible storyboard
- Single completed portrait video
- Batch monitor overview
- Batch detail inspector
- Brand-package enabled and disabled states
- AI Image workbench and result grid

Inspect cropping, player bounds, overflow, typography, spacing, focus, empty/error states, and mobile behavior. A screenshot alone is not considered a pass; the core controls must be exercised.

### 13.4 Completion gate

Before commit and push:

- Type checking passes.
- Focused and full unit tests pass.
- Production build passes with required rehearsal configuration.
- Single and batch browser journeys pass using realistic Shuyu mocks.
- Manual visual comparison finds no enlarged/cropped detail player or blocked core interaction.
- `git diff` contains only intended project changes; pre-existing user files remain untouched.

## 14. Delivery Order

1. Lock and test the audited Shuyu provider/catalog contract.
2. Decouple upload from AI review and introduce server-owned asset identity.
3. Move AI Image generation to durable Shuyu tasks and simplify its UI.
4. Add durable storyboards and the single approval gate.
5. Extend the storyboard stage and idempotency fixes to batch generation.
6. Add versioned workspace brand packages and deterministic post-processing.
7. Replace the batch detail overlay and share bounded media components.
8. Run full unit, build, browser, and visual regression; then commit and push.
