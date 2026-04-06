# ReelForge — Agent 规格说明

## Agent 总览

| Agent | 目标 | 调用 LLM | 调用规则引擎 | 调用外部服务 |
|-------|------|---------|------------|------------|
| Intake Agent | 接收需求，生成 Brief | ✅ | ✅ | ❌ |
| Research Agent | 整理趋势和项目数据 | ✅ | ❌ | ✅ (数据API) |
| Strategy Agent | 数据转内容策略 | ✅ | ✅ | ❌ |
| Script Agent | 生成脚本/字幕/口播 | ✅ | ✅ | ❌ |
| Video Production Agent | 视频生成调度 | ❌ | ❌ | ✅ (视频API) |
| QA Agent | 视频质检和评分 | ✅ | ✅ | ❌ |
| Delivery Agent | 交付准备和记录 | ❌ | ❌ | ✅ (存储) |
| Learning Agent | 数据沉淀和优化建议 | ✅ | ❌ | ❌ |

---

## 1. Intake Agent

**目标**: 接收客户自由文本需求，转化为标准化项目 Brief

**输入**:
```json
{
  "raw_requirements": "客户的自由文本描述",
  "client_name": "Acme Corp",
  "client_industry": "e-commerce",
  "platform": "tiktok"
}
```

**输出**: `brief.schema.json` 格式的结构化 Brief

**处理逻辑**:
1. 规则引擎: 提取关键词，检查输入完整性
2. LLM: 将自由文本转为结构化 JSON
3. 规则引擎: 校验 Brief 完整性，标记缺失字段

**上游**: 客户输入 / API
**下游**: Research Agent, Strategy Agent

---

## 2. Research Agent

**目标**: 采集平台趋势数据、竞品分析、受众洞察

**输入**:
```json
{
  "brief": { "...brief schema..." },
  "platform": "tiktok",
  "industry": "e-commerce"
}
```

**输出**:
```json
{
  "research_report": {
    "trending_topics": [...],
    "competitor_analysis": [...],
    "audience_insights": {...},
    "platform_trends": {...}
  }
}
```

**处理逻辑**:
1. 外部服务: 采集平台数据（MVP 阶段使用 mock 数据）
2. LLM: 分析和总结趋势

**上游**: Intake Agent (Brief)
**下游**: Strategy Agent

---

## 3. Strategy Agent

**目标**: 将研究数据转化为可执行的内容策略

**输入**: Brief + Research Report

**输出**: `strategy.schema.json` 格式的内容策略

**处理逻辑**:
1. 规则引擎: 加载平台最佳实践约束
2. LLM: 生成内容支柱、选题建议、调性指南
3. 规则引擎: 校验策略合理性

**上游**: Intake Agent (Brief), Research Agent (Report)
**下游**: Script Agent

---

## 4. Script Agent

**目标**: 生成优化的短视频脚本，包含口播、字幕和画面指导

**输入**: Brief + Strategy + Topic

**输出**: `script.schema.json` 格式的视频脚本

**处理逻辑**:
1. 规则引擎: 计算目标字数（时长 × 语速），加载平台约束
2. LLM: 生成完整脚本
3. 规则引擎: 校验脚本质量（语速、结构完整性）

**上游**: Strategy Agent
**下游**: Video Production Agent, QA Agent

---

## 5. Video Production Agent

**目标**: 调度视频生成任务，管理生成过程

**输入**: Script + Video Params

**输出**: `video_job.schema.json` 格式的任务记录

**处理逻辑**:
1. 根据参数选择合适的 video provider
2. 构造生成请求并提交
3. 轮询/回调获取生成状态
4. 处理失败重试（最多 3 次）

**上游**: Script Agent (审核通过的脚本)
**下游**: QA Agent

---

## 6. QA Agent

**目标**: 对生成视频进行自动质检和评分

**输入**: Video Job + Script + Brief

**输出**: `qa_report.schema.json` 格式的质检报告

**处理逻辑**:
1. 规则引擎: 技术指标检测（时长、大小、分辨率）
2. LLM: 内容质量评估（画面、音频、内容一致性）
3. 计算综合评分，判断是否自动通过

**评分权重**: Visual 25% + Audio 20% + Content 35% + Technical 20%
**自动通过阈值**: overall ≥ 70 且无 critical issues

**上游**: Video Production Agent
**下游**: Delivery Agent (通过) / Script Agent (拒绝返工)

---

## 7. Delivery Agent

**目标**: 准备交付文件，生成交付记录

**输入**: Video Job + QA Report + Project

**输出**: `delivery_record.schema.json` 格式的交付记录

**处理逻辑**:
1. 准备交付格式的文件（转码、水印等）
2. 上传到交付存储位置
3. 生成交付记录和成本汇总

**上游**: QA Agent (通过的视频)
**下游**: Learning Agent (交付后数据回流)

---

## 8. Learning Agent

**目标**: 沉淀表现数据，生成优化建议

**输入**: Delivery Records + Performance Data

**输出**:
```json
{
  "learning_report": {
    "insights": [...],
    "optimization_suggestions": [...],
    "cost_analysis": {...},
    "quality_trends": {...}
  }
}
```

**处理逻辑**:
1. 聚合多次交付的表现数据
2. LLM 分析趋势和模式
3. 生成可操作的优化建议

**上游**: Delivery Agent (交付数据 + 表现数据)
**下游**: Strategy Agent (优化下一轮策略)

---

## Agent 交互图

```
                    ┌──────────────┐
                    │ Intake Agent │
                    └──────┬───────┘
                           │ Brief
                    ┌──────▼───────┐
                    │Research Agent│
                    └──────┬───────┘
                           │ Report
                    ┌──────▼────────┐
                    │Strategy Agent │
                    └──────┬────────┘
                           │ Strategy
                    ┌──────▼───────┐
                    │ Script Agent │
                    └──────┬───────┘
                           │ Script
              ┌────────────▼─────────────┐
              │Video Production Agent    │
              └────────────┬─────────────┘
                           │ Video
                    ┌──────▼──────┐
                    │  QA Agent   │──── rejected ──→ [返回 Script/Video]
                    └──────┬──────┘
                           │ QA Pass
                    ┌──────▼────────┐
                    │Delivery Agent │
                    └──────┬────────┘
                           │ Delivered
                    ┌──────▼────────┐
                    │Learning Agent │──── feedback ──→ [Strategy Agent]
                    └───────────────┘
```
