# ReelForge — JSON Schema 说明

## Schema 文件清单

| Schema 文件 | 用途 | 产出者 | 消费者 |
|------------|------|--------|--------|
| `brief.schema.json` | 客户项目 Brief | Intake Agent | Research/Strategy/Script Agent |
| `strategy.schema.json` | 内容策略 | Strategy Agent | Script Agent |
| `script.schema.json` | 视频脚本 | Script Agent | Video Production Agent, QA Agent |
| `video_job.schema.json` | 视频生成任务 | Video Production Agent | QA Agent |
| `qa_report.schema.json` | 质检报告 | QA Agent | Delivery Agent, 人工审核 |
| `delivery_record.schema.json` | 交付记录 | Delivery Agent | Learning Agent, 客户 |

## 设计原则

1. **所有 Agent 间的数据传递必须经过 Schema 校验**
2. **Schema 是 Agent 间的契约** — 修改 Schema 必须同步更新上下游 Agent
3. **使用 JSON Schema Draft-07** — 兼容性最好
4. **每个 Schema 包含 `$id`** — 方便跨 Schema 引用
5. **必填字段最小化** — 只标记流程必须的字段为 required

## Schema 详解

### brief.schema.json

客户项目 Brief 的标准结构。核心字段：

- `brief_id` / `project_id` — 唯一标识和项目关联
- `target_audience` — 受众画像（年龄、性别、兴趣、地区）
- `content_goal` — 内容目标（品牌曝光/产品推广/获客/互动/教育）
- `brand_tone` — 品牌调性
- `key_messages` — 核心传播信息
- `budget_tier` — 预算档位（basic/standard/premium）
- `video_count` / `video_duration_seconds` — 需求量和时长

### strategy.schema.json

内容策略输出。核心字段：

- `content_pillars` — 内容支柱（名称 + 描述 + 权重）
- `topic_suggestions` — 选题建议（主题 + 角度 + 优先级）
- `tone_guidelines` — 调性指南（voice/style/dos/donts）
- `hashtag_strategy` — 标签策略（主要/次要/趋势）
- `posting_schedule` — 发布计划（频率/最佳时间/时区）
- `platform_constraints` — 平台限制（时长/比例/字数）

### script.schema.json

视频脚本结构。核心字段：

- `hook` — 前3秒吸引语（短视频最关键的部分）
- `body` — 正文内容
- `cta` — 行动号召
- `voiceover_text` — 完整口播文案
- `visual_directions` — 分镜画面指导（时间点 + 画面描述 + 文字叠加 + 转场）
- `version` — 版本号（支持多版本迭代）
- `status` — 状态（draft/review/approved/rejected）

### video_job.schema.json

视频生成任务。核心字段：

- `provider` — 使用的生成服务（mock/seedance/runway/pika）
- `status` — 任务状态（pending/processing/completed/failed/retrying）
- `input_params` — 生成参数（prompt/时长/比例/风格/配音/音乐）
- `output_url` — 生成结果的文件地址
- `retry_count` / `max_retries` — 重试计数
- `cost_cents` — 生成成本（美分）

### qa_report.schema.json

质检报告。核心字段：

- `scores` — 多维评分（overall/visual/audio/content/technical，0-100）
- `issues` — 问题列表（类型 + 严重程度 + 描述 + 时间点 + 建议）
- `auto_pass` — 自动质检结果
- `human_review` — 人工审核（状态/审核人/备注）

### delivery_record.schema.json

交付记录。核心字段：

- `delivery_url` — 交付文件地址
- `client_feedback` — 客户反馈（评分/评论/是否要求修改）
- `performance_data` — 表现数据（播放/点赞/分享/评论/完播时长/互动率）
- `cost_summary` — 成本汇总（LLM成本/视频生成成本/总成本/返工次数）

## 扩展规划

未来可能新增的 Schema：
- `client.schema.json` — 客户档案
- `campaign.schema.json` — 营销活动
- `template.schema.json` — 脚本模板
- `analytics.schema.json` — 分析报告
