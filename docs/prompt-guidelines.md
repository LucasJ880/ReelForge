# ReelForge — Prompt 设计指南

## 核心原则

### 1. 结构化输出优先
所有 LLM 调用都应该明确要求 JSON 格式输出，并指定 schema。

```
BAD:  "请帮我写一个视频脚本"
GOOD: "根据以下 Brief 生成视频脚本，输出必须是 JSON 格式，包含以下字段: title, hook, body, cta, voiceover_text, visual_directions, duration_seconds"
```

### 2. 角色 + 规则 + 输入 + 输出格式
每个 Prompt 模板都应包含四部分：

```
[System Prompt]   — 定义 Agent 角色和通用规则
[Rules]           — 具体的约束条件
[Input Template]  — 输入变量的模板
[Output Format]   — 期望的输出 JSON 结构
```

### 3. 温度参数建议

| 任务类型 | 推荐温度 | 原因 |
|---------|---------|------|
| Brief 结构化 | 0.3 | 需要准确提取，低创造性 |
| 策略生成 | 0.5 | 需要一定创造性但要可控 |
| 脚本生成 | 0.7 | 需要创意和新颖表达 |
| QA 评审 | 0.2 | 需要严格客观的评估 |
| 数据分析 | 0.3 | 需要准确的分析和总结 |

## Prompt 文件组织

```
prompts/
├── intake/
│   └── brief_generation.md     — Brief 结构化生成
├── strategy/
│   └── content_strategy.md     — 内容策略生成
├── script/
│   └── script_generation.md    — 脚本生成
└── qa/
    └── video_review.md         — 视频质量审核
```

## 变量替换约定

使用 `{{variable_name}}` 格式的占位符：

```
Client: {{client_name}}
Platform: {{platform}}
Brief: {{brief_json}}
```

在代码中使用简单的字符串替换：
```python
prompt = template.replace("{{client_name}}", client_name)
```

## 模型选择策略

| 任务 | 推荐模型 | 备选模型 | 原因 |
|------|---------|---------|------|
| Brief 结构化 | GPT-4o-mini | DeepSeek | 简单任务，成本优先 |
| 策略生成 | GPT-4o | DeepSeek | 需要较强分析能力 |
| 脚本生成 | GPT-4o | Claude-3.5 | 需要创意写作能力 |
| QA 评审 | GPT-4o | GPT-4o-mini | 需要多维度评估能力 |
| 趋势分析 | DeepSeek | GPT-4o-mini | 成本优先，非核心创意 |

## 迭代优化流程

1. **记录每次 Prompt 调用的输入输出**（通过 LLMClient 的日志）
2. **标记质量问题**（通过 QA Agent 的反馈）
3. **定期分析**（哪些 Prompt 产出质量低）
4. **A/B 测试**（同一任务用不同 Prompt 版本）
5. **版本管理**（Prompt 文件纳入 Git 管控）

## 安全规则

1. **不要在 Prompt 中暴露 API Key**
2. **不要在 Prompt 中包含客户敏感数据**（使用引用而非内联）
3. **对 LLM 输出做 Schema 校验**（不要盲目信任输出）
4. **设置 max_tokens 上限**（防止异常高消耗）
5. **使用 tenacity 做重试**（网络错误和超时）
