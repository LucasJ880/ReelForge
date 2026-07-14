# GitHub scheduler observation

- Observed: 2026-07-13/14 UTC with read-only `gh workflow list` and `gh run list`.
- Active workflows: `poll-videos`, `process-batches`, `stitch-videos`.
- Workflow declaration: each uses `cron: "*/5 * * * *"`.
- Vercel fallback: none; `vercel.json` contains only `$schema`.
- Digital human: `digital-human-render` has historical runs but is not in the active workflow list.

Representative scheduled start times (UTC):

| Workflow | Starts | Observed gaps |
|---|---|---|
| process-batches | 16:55, 18:42, 20:03, 21:09, 22:08, 23:11, 00:07 | approximately 56–107 minutes |
| poll-videos | 17:31, 18:57, 20:16, 21:14, 22:11, 23:11, 00:06 | approximately 55–86 minutes |
| stitch-videos | 17:44, 19:05, 20:22, 21:26, 22:27, 23:26, 00:52 | approximately 59–86 minutes |

Conclusion: workflow success when started does not demonstrate a five-minute execution cadence. This is RF-005, not a claim that GitHub Actions is permanently unavailable.

