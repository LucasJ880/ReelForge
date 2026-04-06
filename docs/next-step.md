# ReelForge — 下一阶段开发任务清单

> 范围: 仅限 Phase 3 收尾 — 接入真实 LLM 到 StrategyAgent 和 ScriptAgent
> 不扩展新功能 | 不做 UI | 不做自动发布 | 不做多平台 | 不改商业方向
> 更新时间: 2026-03-13

---

## 当前代码状态

| 组件 | 状态 | 说明 |
|------|------|------|
| StrategyAgent (`v0.2.0`) | LLM 代码就绪 | `_llm_generate` 已写, prompt 已外置, 未经真实调用验证 |
| ScriptAgent (`v0.2.0`) | LLM 代码就绪 | 同上 |
| LLMClient | 可用 | LiteLLM 封装, 3 次重试, JSON 解析容错, token 统计 |
| Prompt 模板 | 4 个文件就绪 | `strategy/{system,user}.txt`, `script/{system,user}.txt` |
| run_demo.py | mock/real 切换就绪 | 通过 `OPENAI_API_KEY` + `REELFORGE_MODE` 控制 |
| Mock 闭环 | 已验证通过 | 6 步全通, Schema 校验全 pass |
| Real 闭环 | **未验证** | 从未用真实 API Key 跑过 |

---

## 必做 (阻塞 Phase 3 完成)

### T1. 配置 .env 并首次运行 real 模式

**目标**: 确认 LLMClient -> LiteLLM -> OpenAI 链路真实可通

```
# .env
OPENAI_API_KEY=sk-xxxxxxxx
REELFORGE_MODEL=gpt-4o-mini
```

```powershell
$py = "C:\Users\Lucas\python312\python.exe"
$env:PYTHONIOENCODING = "utf-8"
& $py scripts/run_demo.py
```

**验收标准**:
- run_demo.py 输出 `[REAL]` 标识
- Strategy 步骤返回真实 JSON, schema 校验 pass
- Script 步骤返回真实 JSON, schema 校验 pass
- 控制台打印 token 用量

**风险点**:
- LiteLLM 包版本兼容性 (当前嵌入式 Python 环境)
- `response_format: {"type": "json_object"}` 对 gpt-4o-mini 的支持
- 网络代理/防火墙问题 (中国网络环境)

---

### T2. 修复 LLM 调用失败无 fallback 的问题

**现状**: `_llm_generate` 抛异常后, Pipeline 直接 fail, 无降级。

**位置**: `strategy_agent.py:115-127`, `script_agent.py:107-119`

**改动**: 在 `execute()` 中 catch `_llm_generate` 异常, 自动降级到 `_mock_generate`, 并在 metadata 中标记 `"mode": "llm_fallback"`。

```python
# 伪代码 — 两个 Agent 的 execute() 均需修改
if self.llm_client:
    try:
        result = await self._llm_generate(...)
    except Exception as e:
        self.logger.warning("llm_fallback", error=str(e))
        result = self._mock_generate(...)
        metadata_mode = "llm_fallback"
else:
    result = self._mock_generate(...)
```

**验收标准**: 断开网络或填入错误 API Key 时, demo 不崩溃, 自动降级到 mock 并打印 `[WARN] LLM failed, falling back to mock`。

---

### T3. 根据真实 LLM 输出调优 Prompt

**触发条件**: T1 跑通后, 对比 LLM 实际返回 vs schema 期望。

**可能需要调的点**:

| 文件 | 潜在问题 | 调优方向 |
|------|---------|---------|
| `prompts/strategy/user.txt` | LLM 返回字段名与 schema 不完全匹配 (如 `topics` vs `topic_suggestions`) | 在 Required Output 注释中强调精确 key 名 |
| `prompts/strategy/user.txt` | `topic_suggestions` 数量不够或格式不对 | 加 `Generate exactly {{video_count}} topics` 约束 |
| `prompts/script/user.txt` | `visual_directions` 格式不一致 | 加 `Each item MUST have: timestamp, description, text_overlay, transition` |
| `prompts/script/system.txt` | 中文场景口播字数控制不准 | 按 `language` 分支给不同的字数规则 |

**验收标准**: real 模式下 Strategy 和 Script 的 schema 校验均 pass, 无 `[WARN]`。

---

### T4. 统一 QA auto_pass 阈值

**现状冲突**:
- `qa_agent.py` 内部 `auto_pass` 阈值: **80**
- `qa_review.py` Pipeline 中 `route_review` 阈值: **70**

**改动**: 统一为一个常量, 建议放在 `qa_agent.py` 顶部定义, Pipeline 引用 Agent 的阈值, 不重复定义。

**验收标准**: `QAAgent.AUTO_PASS_THRESHOLD` 为唯一真值来源, Pipeline 读取该值。

---

### T5. 验证 Schema 校验覆盖 LLM 输出

**现状**: `schemas/models.py` 中的 Pydantic 模型在 `run_demo.py` 做了 `validate_schema()`, 但:
- `Strategy` 模型中 `topic_suggestions` 的类型是 `list[TopicSuggestion]`, LLM 可能返回不严格匹配的结构
- `Script` 模型中 `visual_directions` 的类型是 `list[VisualDirection | dict]`, 已做兼容但需验证

**改动**: 在 T1 real 运行后, 如果 schema 校验报 `[WARN]`, 修复 Pydantic 模型或 prompt 使其匹配。

**验收标准**: real 模式下所有 `validate_schema` 均为 `[OK]`。

---

## 可延后 (不阻塞 Phase 3, 但建议 Phase 4 前完成)

### D1. LLM 输出结果持久化到文件

**现状**: `run_demo.py` 会保存 JSON 到 `storage/demo_output/`, 但 `_llm_usage` 和 `_llm_model` 被 `clean()` 过滤掉了。

**改动**: 将 `_llm_usage` 和 `_llm_model` 改为非 `_` 前缀的标准字段（如 `llm_usage`, `llm_model`）, 或在 `clean()` 中保留。

**价值**: 便于追溯每次调用的模型、token 用量、成本。

---

### D2. 添加 LLM 成本估算

**现状**: `services/llm/providers.py` 有 `estimate_cost()` 函数, 但 `run_demo.py` 未调用。

**改动**: 在 demo summary 中显示预估成本 `$0.xx`。

---

### D3. 支持 DeepSeek / Gemini 模型

**现状**: `LLMClient` 通过 LiteLLM 理论支持, 但未实际测试过 `deepseek/deepseek-chat` 或 `gemini/gemini-pro`。

**改动**: 用不同模型跑 demo, 验证 prompt 兼容性（尤其 `response_format: json_object` 在非 OpenAI 模型上的行为）。

---

### D4. Strategy 输出多个 Topic 时批量生成 Script

**现状**: `ScriptGenerationPipeline.select_topic` 只取 `topic_suggestions[0]`, 浪费了 Strategy 输出。

**改动**: 支持循环生成或指定 topic index。

**注意**: 这属于功能增强的边界, 但不违反"不扩展新功能"原则, 因为 ScriptAgent 已经支持, 只是 Pipeline 编排层的改动。

---

### D5. run_demo.py 输入参数化

**现状**: `raw_requirements` 和 `client_name` 等硬编码在 `run_demo.py` 中。

**改动**: 支持从命令行参数或 JSON 文件读取, 便于测试不同客户场景。

---

## 暂时不要做

| 项目 | 原因 |
|------|------|
| IntakeAgent 接入 LLM | Phase 3 目标仅 Strategy + Script; Brief 生成逻辑简单, mock 够用 |
| QAAgent 接入 LLM | 规则质检当前够用, LLM 质检是 Phase 4 任务 |
| ResearchAgent 接入真实数据源 | 需要外部 API (TikTok/SocialBlade), 超出当前范围 |
| 数据库持久化 | Phase 4 任务, 当前 JSON 文件足够验证链路 |
| FastAPI 端点对接 Pipeline | Phase 4 任务, 当前 CLI demo 足够 |
| 人工审核后台 UI | 明确不做 UI |
| 多平台支持 (YouTube/Instagram) | 明确不做多平台, 先 TikTok 打通 |
| 自动发布到 TikTok | 明确不做 |
| Celery/Redis 异步任务 | 当前不需要并发, 同步跑通即可 |
| 视频生成接入真实 API | Phase 4 任务, 当前 mock 够用 |
| 测试用例补全 | 先把 real 链路跑通, 再写 test |
| CI/CD | 项目太早期 |
| Docker 化 | 项目太早期 |

---

## 执行顺序

```
T1 (跑通 real) ──→ T2 (加 fallback) ──→ T3 (调 prompt) ──→ T5 (验 schema)
                                                                    │
                                           T4 (统一 QA 阈值) ──────┘
```

**预计工时**: 2-4 小时 (取决于网络环境和 LLM 输出质量)

**完成标志**: `python scripts/run_demo.py` 在 real 模式下 6 步全 `[OK]`, 0 个 `[WARN]`, 0 个 `[FAIL]`, token 用量显示正常。

---

## 快速启动命令

```powershell
# 1. 配置 API Key
echo "OPENAI_API_KEY=sk-xxx" > .env

# 2. 跑 real demo
$env:PYTHONIOENCODING = "utf-8"
C:\Users\Lucas\python312\python.exe scripts/run_demo.py

# 3. 对比 mock vs real 输出
C:\Users\Lucas\python312\python.exe scripts/run_demo.py  # real
$env:REELFORGE_MODE = "mock"
C:\Users\Lucas\python312\python.exe scripts/run_demo.py  # mock
```
