# Phase 4 · 合规最小集 GATE 4 验收报告

日期：2026-07-13（America/Toronto）

状态：**等待人工确认，未越过 GATE 4**

## 部署语境

- 公司与运营地：加拿大安大略省；服务器和数据库在北美。
- 当前视频默认路径：BytePlus 国际端点；中国区端点由 endpoint guard 拒绝。
- Buddy 本轮仅保留 `shuyu_api_key` 配置名与 backlog，零真实调用。
- 不做 ICP、公安备案或中国大陆云架构。

## 显式假设

`ASSUMPTION: privacy@aivora.ai 是工程草稿联系邮箱。人工需确认邮箱真实可达，或在客户开放前配置 NEXT_PUBLIC_PRIVACY_EMAIL。`

`ASSUMPTION: 具体数据保存期限尚未由业务和律师确认，因此草稿不虚构固定天数；定稿前必须补齐。`

`ASSUMPTION: OpenAI Moderation 负责文本与图片。视频使用已生成缩略图；没有可审缩略图的真实模式请求 fail-closed 进入人工复核，不把缺乏覆盖误报成已审核。`

## 已完成

1. `/privacy` 与 `/terms` 工程草稿已上线到路由，登录页和统一工作区均有入口；文本明确标注待加拿大律师复核。
2. 成品库、成品播放器和批次播放器使用通用 `AI Generated · Aivora` 标签。
3. 渲染管线增加 `AI_DISCLOSURE_END_CARD_ENABLED` 开关；开启时由自有 ffmpeg end-card renderer 生成片尾披露，不交给视频模型画文字。
4. 生成留痕闭环：`VideoJob` 保存 prompt、provider、外部 job id、模板快照、提交/开始/完成时间；BatchJob 关联请求用户和不可变 StyleTemplate 版本；UsageLog 保存用户消费审计。
5. OpenAI `omni-moderation-latest` provider 已接入上传后、视频 provider 提交前、成片 READY 前三个边界；配置缺失、服务失败和人工复核均 fail-closed。mock 模式不发网络请求。
6. 客户成品详情有举报入口；`/internal/reports` 提供队列、复审、驳回和一键下架。下架使用事务 + compare-and-swap，隐藏客户成品但不删除原媒体和审计记录。
7. `20260713_phase4_content_reports` 已在 Neon 演练分支由 owner 角色成功应用；应用角色已验证可读新表。

## 自动验证

| 验证 | 结果 |
|---|---:|
| TypeScript | 通过 |
| 全量 Node 测试 | 638 passed / 1 skipped / 0 failed |
| Production build | 通过；包含 privacy、terms、reports 路由 |
| ESLint | 0 errors；7 个既有 warnings |
| 本地浏览器 390px 响应式核验 | privacy/terms 无横向溢出，0 console errors |
| Phase 4 定向契约测试 | 9 passed / 0 failed |
| 模板 + provider 回归合并定向测试 | 29 passed / 0 failed |
| Neon 演练迁移 | 成功，15 migrations current |
| 新表应用角色读取 | 成功 |

浏览器证据：

- `docs/evidence/phase-4/privacy-mobile-390.png`
- `docs/evidence/phase-4/terms-mobile-390.png`

## 律师待审清单

- PIPEDA 目的、同意、访问/更正/删除流程与确定保存期限。
- 第三方处理方、跨境处理和 subprocessors 的合同披露。
- 责任限制、赔偿、适用法律、终止与 B2B order form 优先级。
- AI 输出权利、平台披露、客户输入权利保证与禁止用途。
- `privacy@aivora.ai` 联系方式及响应流程。

## 不属于本 Gate 的结论

- 31 个原创模板和 mock 测试只能证明 prompt 约束、调度与 UI，不证明真实视频的幻觉率；P1/P2 仍需人工同行对照组和真实 provider 样本。
- Buddy SL-A 缺官方文档、数据区域和计费口径，SL-B/SL-C 未关闭。
- 生产迁移、全量测试、500×3 mock 压测与部署尚未执行；GATE 4 前不启动后续真实批次。

## GATE 4 人工决议

- [ ] 批准工程合规最小集与律师待审清单，允许进入 Phase 5 mock readiness
- [ ] 要求修改（请标明页面、处理路径或文案）
