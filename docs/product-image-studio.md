# Product Image Studio

Product Image Studio lives at `/app/create/images` and uses one customer workflow: an optional owned reference image, one prompt, compact aspect-ratio/resolution/result-count settings, and advanced style presets.

New public tasks are submitted only through an audited, currently available Shuyu Image 2 plan. The server persists the provider request key, external task ID, plan/model/resolution/point snapshots, source asset relation, polling state, and every durable output asset relation. It does not call the generic OpenAI/Volcengine image provider path.

Reference uploads use `/api/upload/blob`. They are authenticated, quota checked, size/MIME/magic-byte validated, stored under randomized keys, and persisted as owner-scoped `MediaAsset` records without platform AI review. Product-image requests submit the asset ID rather than a client URL.

Shuyu tasks are reconciled by the authenticated status endpoint and the existing polling cron. Completed remote outputs are accepted only from the configured `SHUYU_OUTPUT_HOST_ALLOWLIST` (or the narrow built-in provider hosts), with HTTPS-only URL validation, redirect rejection, content-length and streamed byte caps, an abort timeout, and cleanup when the controlled-storage copy cannot be made durable.

Successful results support download, variation, continued editing, and handoff to single or batch video creation. Idempotent replays reconstruct the active source and output asset DTOs from persisted relations.
