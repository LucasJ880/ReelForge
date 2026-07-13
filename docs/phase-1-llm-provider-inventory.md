# Phase 1 · LLM 调用点清单与北美默认 provider 提案

状态：**OpenAI 北美默认已确认；活动调用点已迁移至 AI provider 抽象。**

本报告只记录环境变量是否存在，不记录任何密钥值。

## 1. 当前结论

- 当前代码默认 `AI_PROVIDER=openai`；未显式配置时也解析为 OpenAI。
- 当前环境存在 `OPENAI_API_KEY` 与 OpenAI 模型配置，可作为北美路径候选。
- 当前环境也存在旧 `ARK_*` 配置，但其账号归属与数据区域不能从代码证明；**不得据此启用 Volcengine LLM**。
- `VolcengineProvider` 的代码默认 base URL 仍是 `ark.cn-beijing.volces.com`。它当前不是默认 provider，按人工裁决暂时保留，但不得成为北美生产默认。
- 活动业务调用已统一通过 `src/lib/ai`；OpenAI helper 只保留在 `OpenAiProvider` 适配器内部。封存的 digital-human director 保留旧 import，但 feature flag 与 service 双重 fail-closed，无法触发。

## 2. 活动调用点

| 调用点 | 用途 | 能力 / tier | 当前接线 |
|---|---|---|---|
| `src/app/api/personal/agent-chat/route.ts` | 旧个人 Agent 对话与创意回复 | creative / `personal_agent_chat` | 直连 OpenAI helper；待旧路由迁移 |
| `src/lib/services/ad-agent-service.ts` | Director 产出与 Reviewer 复核 | creative + qa | 直连 OpenAI helper |
| `src/lib/services/angle-service.ts` | 创意角度生成 | creative / `angle_generation` | 直连 OpenAI helper |
| `src/lib/services/creative-evidence-service.ts` | 案例素材结构化拆解 | JSON chat | 直连 OpenAI helper |
| `src/lib/services/director-service.ts` | DirectorPlan / storyboard 策略 | director / `director_plan` | 直连 OpenAI helper |
| `src/lib/services/discovery-service.ts` | 市场调研与结构化摘要 | research / `market_research` | 直连 OpenAI helper |
| `src/lib/services/distillation-service.ts` | 赛马 top-3 创意蒸馏 | JSON chat | 直连 OpenAI helper |
| `src/lib/services/prompt-service.ts` | 视频 prompt 生成 | creative / `video_prompt_generation` | 直连 OpenAI helper |
| `src/lib/services/qa-service.ts` | AI QA 评分与建议 | qa / `ai_qa_review` | 直连 OpenAI helper |
| `src/lib/services/scene-service.ts` | 脚本拆分场景 | creative / `scene_breakdown` | 直连 OpenAI helper |
| `src/lib/services/script-service.ts` | 客户视频脚本 | creative / `client_script` | 直连 OpenAI helper |
| `src/lib/services/selling-point-service.ts` | 卖点提取/生成 | creative / `selling_points` | 直连 OpenAI helper |
| `src/lib/video-generation/creative-strategist.ts` | 统一输入的创意策略与 brief | creative / `unified_creative_brief` | 直连 OpenAI helper |
| `src/lib/video-generation/consistency-bible.ts` | 多段一致性约束 | videoPrompt / `consistency_bible` | 直连 OpenAI helper |
| `src/lib/video-generation/prompt-intelligence.ts` | 统一流水线分段 prompt | videoPrompt / `unified_segment_prompts` | 直连 OpenAI helper |
| `src/lib/video-generation/frame-qa.ts` | 成片抽帧视觉 QA | vision / image analysis | 直连 OpenAI helper |
| `src/lib/video-generation/visual-reference-analysis.ts` | 用户参考图理解 | vision / image analysis | 直连 OpenAI helper |
| `src/lib/services/logo-service.ts` | Logo 候选图生成 | image generation | 直连 OpenAI image helper |
| `src/lib/video-generation/digital-human/store-ad-director.ts` | 已封存数字人脚本/分镜/旁白 | director | 代码保留但上游触发已 fail-closed；不纳入切换 |
| `src/app/api/health/route.ts` | provider 配置健康检查 | abstraction status | 已走 `src/lib/ai` 抽象 |

`classifier` 说明：当前统一输入的分类器 `src/lib/video-generation/input-classifier.ts` 是本地确定性/启发式逻辑，没有真实 LLM 调用，因此无需 provider 迁移。

## 3. 已执行决议

建议默认 provider：**OpenAI**。

理由：已有北美可用凭证配置；现有业务 helper、tier 解析、vision 与 image 能力已稳定使用；`OpenAiProvider` 已是兼容包装层。切换实现应是把上表活动调用点逐个改为 `getAiProvider()`，保持原 tier、stage、mock/fallback、usage log 与结构化返回断言 1:1，不改变业务提示词。

1. 活动调用方已改为 `getAiProvider()` 或 `src/lib/ai` 的兼容形状 helper；tier、stage、mock/fallback 与 usage log 保持不变。
2. `AI_PROVIDER` 默认仍是 `openai`；Volcengine 不是默认且没有真实调用。
3. `VolcengineProvider` 暂保留为非默认实现，待封存调用点清零后归档至 `deploy/china-future/`。
4. 旧 `ARK_*` 凭证未用于验证或真实调用。

验证方案：mock 契约测试先覆盖所有 tier；再在人工批准和成本预算下，对 strategist、director、QA、vision 各做一个最小真实样本；验证结构化 schema、usage log、延迟与失败回退后，才允许将 Volcengine LLM 归档到 `deploy/china-future/`。
