# MoneyPrinterTurbo 源码调研与借鉴决策（2026-08-01）

对象：[harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)（MIT，5 万+ star）。
读过的源码：`app/services/task.py`（编排）、`material.py`（素材搜索）、`voice.py`（TTS 与字幕）、
`video.py`（1372 行，合成）。

## 一、它的完整管线

```
主题 → LLM 脚本 → LLM 搜索词（8 个，可按脚本叙事顺序）
     → edge-tts 配音（WordBoundary 时间戳）
     → 字幕（直接用 TTS 时间戳出 SRT，不跑 Whisper）
     → Pexels / Pixabay / Coverr 免费真实素材（按画幅/时长筛选，24h 缓存，key 轮换）
     → ffmpeg/moviepy 拼接（裁到画幅、max_clip_duration 控切换频率、字幕烧录、BGM 混音）
     → 一次出多个候选让用户挑
```

本质：**它不生成一帧画面**。视频 = 免费真实 b-roll + 配音 + 字幕。
成本趋零，速度取决于下载与转码。

## 二、与 Aivora 的关键差异

| | MPT | Aivora |
|---|---|---|
| 画面来源 | 免费图库真实视频 | AI 生成（Shuyu / BytePlus，付费） |
| 单条成本 | ≈0（API 免费额度内） | Shuyu 900→700 积分/条 |
| 产品一致性 | 无（通用 b-roll，与商家产品无关） | 有（产品锚定 / logo 保真是我们的护城河） |
| 供应商风险 | 三个图库互备 | Shuyu 单点，7 天成功率 28.6%，两次打穿生产 |

**结论**：它解决的问题恰好是我们最痛的两个 —— 供应商单点（PRD 风险 #5）与
单条成本（C2 要求全链路成本降 ≥30%）。但它做不了我们的护城河（产品实拍级一致性）。
所以借鉴的定位是：**给「视频」形态加一条趋零成本的 b-roll 路线，做第三线路与兜底，
不替代产品锚定主线。**

## 三、采纳清单（按价值排序）

### 1. ✅ Stock footage 素材线路（Pexels + Pixabay）—— 本轮落地

- 命中 PRD 风险 #5：C1 自动降级需要一条真正可用的备胎，而不是两条都会漂移的付费线。
- 命中 C2 成本指标：图库 API 免费（Pexels 200 次/小时，Pixabay 100 次/分钟）。
- 命中 O1 场景：本地商家周更的「流程讲解 / 场景种草」类视频，本来就该用真实画面
  （同行验证过的形态，不是我们发明的）。
- **需要 API key（免费注册）→ 进 CEO 清单**。无 key 时诚实停等（与抠图适配器同一模式）。

工程细节照抄它踩过的坑：
- 搜索结果 24h 缓存，**空结果不缓存**（区分「没搜到」与「请求失败」）；
- 多 key 轮换（计数器取模）；
- 失败日志脱敏（移除 key 与代理凭据）；
- 时长下限 + 画幅方向筛选，方形素材少则放宽由合成层裁。

### 2. ✅ 搜索词按脚本叙事顺序生成（match_script_order）—— 本轮落地

它的经验：搜索词乱序会导致素材时序混乱（开头讲量尺、画面却是完工特写）。
落地在 b-roll 计划生成的 LLM 契约里：每个镜头段一个搜索词，顺序即叙事顺序。

### 3. ✅ TTS 时间戳直接出字幕 —— 记入设计，等 TTS key

它用 WordBoundary 事件直接聚合成 SRT，跳过 Whisper（3GB 模型 + GPU）。
我们接正式 TTS（OpenAI `tts-1` / Azure）时字幕就顺带拿到，零额外成本。
按标点拆脚本、逐段匹配 cue 的聚合策略（中文逐词切割体验差）一并采纳。

### 4. ✅ max_clip_duration 控制素材切换频率 —— 进 b-roll 契约参数

短视频节奏本质上就是「几秒一切」。它做成了用户可调参数，我们做成配方字段
（节奏本来就是我们创意配方的一维，正好与 O4 的 pacing 标注对齐）。

## 四、明确不采纳的（以及为什么）

| 不采纳 | 理由 |
|---|---|
| **edge-tts 做生产配音** | 它是逆向微软消费端接口的 Python 库，无 SLA，MPT 自己都写了 Cloudflare 挑战检测与超时兜底。我们的铁律是只走真实供应商 —— 把逆向接口放进商用管线，等于自己制造下一个 Shuyu。配音走正式 TTS（key 进 CEO 清单） |
| moviepy 合成层 | 我们已有 ffmpeg stitch 基建（含 loudness、字幕文件、品牌封装），MPT 的 moviepy 路线反而比我们现有的重 |
| Whisper 本地转写 | 3GB 模型 + GPU 依赖；采纳方案 3 后不需要 |
| Streamlit WebUI / 多 LLM 聚合层 | 与我们无关；LLM 已有 provider 抽象 |
| 一次出多候选 | 我们已有（故事板抽卡择优），不重复建 |

## 五、落地物

| 物 | 位置 |
|---|---|
| 图库适配器（Pexels/Pixabay，key 轮换 + 脱敏 + 筛选） | `src/lib/providers/stock-footage.ts` |
| b-roll 视频计划服务（脚本→顺序搜索词→选片清单→交现有 stitch） | `src/lib/services/broll-plan-service.ts` |
| 回归测试（顺序契约 / 无 key 诚实失败 / 筛选与轮换） | `tests/stock-footage.test.ts`、`tests/broll-plan.test.ts` |

无 key 时整条线路状态为「即将上线」：入口可见、行为诚实、绝不 mock 出假素材。
