# ReelForge — 成本核算指南

## 成本追踪目标

每条视频必须能追踪到以下成本：
1. **LLM 调用成本** — 各环节的 token 消耗
2. **视频生成成本** — 视频 API 调用费用
3. **返工成本** — 因质检不通过导致的重做费用
4. **总成本** — 汇总到 delivery_record.cost_summary

## LLM 成本估算

### 各 Agent 单次调用预估

| Agent | 模型 | 输入 tokens | 输出 tokens | 预估单次成本(USD) |
|-------|------|------------|------------|-----------------|
| Intake Agent | GPT-4o-mini | ~1000 | ~500 | ~$0.0005 |
| Research Agent | DeepSeek | ~2000 | ~1000 | ~$0.0006 |
| Strategy Agent | GPT-4o | ~3000 | ~2000 | ~$0.028 |
| Script Agent | GPT-4o | ~2000 | ~1500 | ~$0.020 |
| QA Agent | GPT-4o | ~2000 | ~1000 | ~$0.015 |
| Learning Agent | GPT-4o-mini | ~3000 | ~1000 | ~$0.001 |

### 单条视频 LLM 总成本预估

```
基础流程（无返工）: ~$0.065
含1次返工:          ~$0.100
含2次返工:          ~$0.135
```

## 视频生成成本

| Provider | 单条视频成本(预估) | 备注 |
|----------|-----------------|------|
| Mock | $0 | 开发测试用 |
| Seedance | TBD | 待接入 |
| Runway Gen-3 | ~$0.50-2.00/视频 | 按秒计费 |
| Pika | ~$0.20-1.00/视频 | 按次计费 |

## 单条视频综合成本

```
场景A (基础30秒视频, 无返工):
  LLM:    $0.065
  视频生成: $0.50
  ──────────
  总计:   $0.565

场景B (高质量60秒视频, 1次返工):
  LLM:    $0.100
  视频生成: $2.00 (含重做)
  ──────────
  总计:   $2.100
```

## 成本追踪实现

### 1. LLM 成本自动记录

通过 `services/llm/client.py` 的 usage 字段：
```python
result["usage"] = {
    "prompt_tokens": ...,
    "completion_tokens": ...,
    "total_tokens": ...,
}
```

结合 `services/llm/providers.py` 的 `estimate_cost()` 计算。

### 2. 视频生成成本

记录在 `video_job.cost_cents` 字段。

### 3. 成本汇总

在 `delivery_record.cost_summary` 中汇总：
```json
{
  "llm_cost_cents": 7,
  "video_gen_cost_cents": 50,
  "total_cost_cents": 57,
  "revision_count": 0
}
```

## 定价参考（服务定价）

```
成本利润比建议:
  基础套餐: 成本 × 5-8倍
  标准套餐: 成本 × 4-6倍
  高级套餐: 成本 × 3-5倍

示例:
  基础30秒视频, 成本 ~$0.57
  建议售价: $3-5/条
  
  批量包 (50条/月):
  建议售价: $100-200/月
```

## 成本优化方向

1. **模型降级** — 非核心环节用 GPT-4o-mini 或 DeepSeek
2. **Prompt 优化** — 减少 token 消耗
3. **缓存** — 相似需求的策略/脚本缓存
4. **批量处理** — 合并 LLM 请求降低开销
5. **减少返工** — 提升 QA 一次通过率
