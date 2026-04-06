# ReelForge — 工作流设计

## 主链路

```
客户建档 → Brief 生成 → 数据采集/整理 → 策略分析 → 选题/脚本生成
    → 视频生成 → AI 质检 → 人工审核 → 交付 → 数据回流
```

## 详细流程

### 1. 项目录入 (Project Intake)

```
客户需求(自由文本/表单)
    │
    ▼
┌─────────────┐
│ Intake Agent │ ← 规则引擎: 输入完整性检查
│              │ ← LLM: 自由文本结构化
└──────┬──────┘
       │
       ▼
  标准化 Brief (brief.schema.json)
       │
       ▼
  [人工确认 Brief]
```

**失败重试点**: LLM 结构化失败 → 重试 2 次 → 人工介入

### 2. 研究分析 (Research & Analysis)

```
  确认的 Brief
       │
       ▼
┌───────────────┐
│ Research Agent │ ← 外部服务: 平台数据采集(TODO)
│                │ ← LLM: 趋势分析和总结
└───────┬───────┘
        │
        ▼
  研究报告 (trending_topics, competitor_analysis, audience_insights)
```

**失败重试点**: 数据采集超时 → 使用缓存数据 → 降级为基础分析

### 3. 策略生成

```
  Brief + 研究报告
       │
       ▼
┌─────────────────┐
│ Strategy Agent   │ ← 规则引擎: 平台最佳实践约束
│                  │ ← LLM: 生成策略建议
└────────┬────────┘
         │
         ▼
  内容策略 (strategy.schema.json)
    ├── content_pillars (内容支柱)
    ├── topic_suggestions (选题建议)
    ├── tone_guidelines (调性指南)
    ├── hashtag_strategy (标签策略)
    └── posting_schedule (发布计划)
```

### 4. 脚本生成 (Script Generation)

```
  Brief + Strategy + 选题
       │
       ▼
┌──────────────┐
│ Script Agent  │ ← 规则引擎: 时长/语速约束
│               │ ← LLM: 核心脚本生成
└───────┬──────┘
        │
        ▼
  视频脚本 (script.schema.json)
    ├── hook (前3秒吸引语)
    ├── body (正文)
    ├── cta (行动号召)
    ├── voiceover_text (口播文案)
    ├── visual_directions (画面指导)
    └── music_style
        │
        ▼
  [人工审核脚本]
```

**失败重试点**: 脚本质量低于阈值 → 重新生成 → 人工修改

### 5. 视频生成 (Video Generation)

```
  审核通过的脚本
       │
       ▼
┌──────────────────────┐
│ Video Production Agent│ ← 外部服务: 视频生成API
│                       │    (Mock/Seedance/Runway)
└──────────┬───────────┘
           │
           ▼
  视频生成任务 (video_job.schema.json)
    ├── status: pending → processing → completed
    ├── output_url
    ├── cost_cents
    └── retry_count
```

**失败重试点**: 生成失败 → 自动重试(最多3次) → 换 provider → 人工介入

### 6. 质检审核 (QA Review)

```
  生成完成的视频
       │
       ▼
┌──────────┐
│ QA Agent  │ ← 规则引擎: 技术指标检测(时长/大小/分辨率)
│           │ ← LLM: 内容质量评分
└─────┬────┘
      │
      ▼
  质检报告 (qa_report.schema.json)
    ├── scores (overall/visual/audio/content/technical)
    ├── issues (问题列表 + 严重程度)
    ├── auto_pass (boolean)
    └── suggestions
      │
      ├── auto_pass = true → 进入交付
      └── auto_pass = false → 人工审核
           ├── approved → 进入交付
           └── rejected → 返回脚本生成/视频生成
```

### 7. 交付 (Delivery)

```
  质检通过的视频
       │
       ▼
┌────────────────┐
│ Delivery Agent  │ ← 存储服务: 文件准备
└───────┬────────┘
        │
        ▼
  交付记录 (delivery_record.schema.json)
    ├── delivery_url
    ├── cost_summary
    └── status: preparing → delivered → accepted
```

### 8. 数据回流 (Feedback Loop)

```
  交付后的表现数据 (views, likes, engagement...)
       │
       ▼
┌─────────────────┐
│ Learning Agent   │ ← LLM: 分析表现数据
└────────┬────────┘
         │
         ▼
  优化报告
    ├── insights (洞察)
    ├── optimization_suggestions (优化建议)
    ├── cost_analysis (成本分析)
    └── quality_trends (质量趋势)
         │
         ▼
  反馈至 Strategy Agent (下一批内容优化)
```

## 状态机

### 项目状态流转

```
intake → research → strategy → scripting → production → qa → review → delivery → completed
                                    ↑                              │
                                    └──────── revision ←───────────┘
```

### 视频任务状态流转

```
pending → processing → completed → [qa_pass] → delivered
    │         │              │
    └─────────┴──── failed ──┴──→ retrying (max 3) → failed_final
```
