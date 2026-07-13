# S5 · CEO 两条成片北美迁移演练

日期：2026-07-13（America/Toronto）  
状态：**PRODUCTION CAS PASS — 等待 CEO 前端播放后置验收与 72h 双读观察**

## 锁定对象

- FinalVideo `cmrii4yyv0014l204jaxluepv` / VideoJob `cmrii4yzr0016l204c4rcwpw6`
- FinalVideo `cmrij6psx0010jl04gj04xoeg` / VideoJob `cmrij6pty0012jl04n6wi5ul8`

两段均为真实 `SEEDANCE_T2V`、源任务 `SUCCEEDED`。原始签名 URL 只用于迁移下载，不写入报告或日志。

## 迁移与媒体证据

| FinalVideo | 源大小 | 源 SHA-256 | 重拼大小 | 重拼 SHA-256 | ffprobe |
| --- | ---: | --- | ---: | --- | --- |
| `cmrii4yyv0014l204jaxluepv` | 21,134,554 B | `4548a8c653810090ec4344d48101b55287af4898ab2e0f9cda91f2049bd5dcc4` | 8,660,515 B | `db2cf1e18485836e76f89a2a5fa2d504313ec4cf75e38cc346b9bd4f268f9a3c` | 15.092993s, H.264, 1080×1920, audio=yes |
| `cmrij6psx0010jl04gj04xoeg` | 16,525,152 B | `1af08f2b18c3792097c2daaf013f461d80feb594604160ebe4061d095c929c59` | 7,418,341 B | `a8f475a0fd65633403749134838d882884a4460baeac00be33945bb6210f7231` | 15.092993s, H.264, 1080×1920, audio=yes |

- 源段 magic byte 检查：PASS（MP4 `ftyp`）。
- 上传目标：已取证的 Vercel Blob `aivora-blob` / IAD1 / public random URL。
- 目标 key：`migrations/beijing-tos/<canonical-url-sha256>/...`，不可枚举前缀。
- 上传后重新下载并比对 SHA-256：2/2 PASS。
- 源对象删除：否。

## 数据库 CAS

- 仅 Neon `phase1-rehearsal-20260713` 分支写入。
- `VideoJob`: `SUCCEEDED + source URL + updatedAt` CAS 到 IAD1 源段 URL。
- `FinalVideo`: `FAILED + updatedAt` CAS claim 为 `STITCHING`，随后 `STITCHING + updatedAt` CAS 为 `READY`。
- `VideoBrief`: `id + finalVideoId + updatedAt` CAS 为 `QA_PENDING` 并写 IAD1 成片 URL。
- 演练通过后以显式双参数授权重复执行生产 CAS；生产 `VideoJob` 仍为 `SUCCEEDED` 且已切换 IAD1 源段 URL，`FinalVideo` 2/2 为 `READY`，`VideoBrief` 2/2 为 `QA_PENDING` 且 URL 与成片一致。
- 生产写入使用 compare-and-swap；重复执行可幂等识别。生产私有证据写入 gitignored `.aivora-private/s5-ceo-production-cas-evidence.json`，不包含数据库连接串。

## 前端核验

- 演练分支 `/app/library` 前两张卡片均显示“视频已完成”。
- 两个 `<video>` 均 `readyState=4`，duration 为 `15.092993`，来源 host 为 IAD1 Vercel Blob。
- 截图：`docs/evidence/phase-0/s5-ceo-library-rehearsal-1440.png`。

关闭 S5 前仍需：CEO 在前端逐条播放确认 → 72 小时双读观察。确认前不得标记 featured/showcase。
