# Aivora 通用电商整合设计

日期：2026-07-26

## 1. 目标

本次更新把当前以 SunnyShutter 为中心的批量视频能力抽象成通用电商模板引擎，同时保留 SunnyShutter 已验证的产品几何锁、品牌尾卡和 3–4 帧故事板抽卡一致性。更新还包括四项面向客户的能力：

1. 登录、批次列表、模板卡和成品库的前端收敛。
2. 8 个行业标准双语电商模板在模板库、单条创作和批量创作中共用同一套稳定 ID。
3. 永久全局品牌包、品牌封装管理页和客户展示墙。
4. Shuyu Seedance 原生口播、后期字幕和 BGM 混音。

所有实现都位于单一集成分支 `codex/aivora-integration-2026-07`。完成自动化测试和真实供应商验收后，先交付验收结果；只有用户明确同意时才合并 `main`。

## 2. 不可回退约束

- 保留 2026-07-22 单条视频 mock 两根因修复。
- 保留 2026-07-22 故事板刷新恢复与部分帧失败恢复。
- SunnyShutter v2 真实出片路径逐字和行为等价。
- 客户视频生成统一走 Shuyu；不得恢复公开的 BytePlus、Volcengine 或 OpenAI 直连选择。
- 批量关键生成路径不导入 OpenAI，不接受客户端任意生成 prompt。
- demo 账号不触发付费生成。
- Shuyu prompt 在合并负向约束后不得超过 5,000 字符。
- 旧 digital-human、Volc TTS 和 OmniHuman 活动入口保持 sealed。
- 数据删除必须先运行 dry-run、保存证据并再次取得用户确认；本轮不会自动执行 `--commit`。

## 3. 方案比较

### 方案 A：单分支一次性重写

直接替换 SunnyShutter 模板、品牌包和组装管线。文件变更少，但任何 P3 音频问题都会阻塞 P0/P1，且难以定位回归。

### 方案 B：单一集成分支、里程碑式兼容迁移（采用）

在同一分支内按 P0、P1、P2、P3 分阶段提交。每个阶段先增加兼容层和测试，再切换消费方。SunnyShutter 继续通过 profile 适配器使用原有锁，通用模板成为新增并行路径。这个方案满足单分支要求，同时保留清晰回退点。

### 方案 C：先建立全新 v3 管线再一次切流

隔离性最好，但会复制模板、dispatch、品牌封装和 ffmpeg 逻辑，维护成本高，也不符合本轮 YAGNI 原则。

## 4. 总体架构

更新后的主流程是：

```text
统一模板目录
  ├─ 模板库
  ├─ 单条创作
  └─ 批量创作
        ↓
通用电商模板 + 品类 shot policy
        ↓
可选 client lock profile（SunnyShutter）
        ↓
故事板抽卡与一致性锁
        ↓
Shuyu Seedance（可选 generate_audio）
        ↓
外部 ffmpeg runner
  ├─ 字幕烧录与 .srt
  ├─ BGM 混音与 ducking
  └─ Logo/尾卡
        ↓
成品库 + 制作过程证据
```

系统按明确边界拆分：

- `generic-shot-policy`：品类允许运镜、几何约束、unsafe 规则和安全 prompt 渲染。
- `generic-commerce-template`：8 个通用叙事骨架及其双语元数据。
- `client-lock-profiles`：客户专属的附加约束，首个 profile 是 `sunnyshutter`。
- `template-catalog`：模板库、单条和批量共用的 canonical ID/slug 目录。
- `workspace-brand-package-service`：用户品牌包与全局只读品牌包的授权和排序。
- `audio-post-production`：口播脚本时间轴、字幕、BGM 和 ffmpeg 参数。
- `shuyu` provider：在已审计视频契约中显式传递 `generate_audio`，不接旧 TTS API。

## 5. P0 前端收敛

### 5.1 登录页

Hero 标题使用较低的 `clamp()` 上限和 700 字重，副文案与三栏指标同步缩小间距。桌面与 390px 移动端均不得横向溢出。视觉基线增加登录页两档截图。

### 5.2 批次列表

批次页从双列大卡改为响应式紧凑表格：

- 桌面列：标题、状态、模板版本、完成/总数、成本快照、时间、查看。
- 小屏使用同一语义行的堆叠表示，不强制宽表横向滚动。
- 表头 sticky，数字列使用 `tabular-nums`。
- 失败与部分失败行使用左侧状态色条，但仍保留可读状态文本。

批次列表新增独立视觉基线，不复用只覆盖详情页的 `batch-monitor` 基线名称。

### 5.3 模板卡

模板 DTO 同时支持 `sampleImage` 与 `sampleVideo`。有真实样片视频时使用现有 `HoverPreviewVideo`；没有时回退静态封面。卡片只保留标题、一行叙事摘要以及稳定性/时长/画幅三个 chip。

### 5.4 成品库

列表不渲染 `status=failed` 且没有安全 `videoUrl` 的死卡。标题与元信息使用固定最小高度和显式截断，避免卡片 cutoff。这个隐藏规则不替代物理清理。

## 6. P1 通用模板引擎

### 6.1 品类 shot policy

`generic-shot-policy.ts` 定义：

```ts
type GenericShotMotion =
  | "static_product"
  | "reveal_transition"
  | "operate_demo"
  | "presenter_point";
```

每个品类 preset 提供：

- 允许的 motion 集合。
- 产品几何和机械约束。
- motion prompt block。
- unsafe 检测器。
- 默认产品 identity lock。

`shutter` preset 复用现有正则和原始英文文本。旧 `renderSafeShutterPrompt()` 变成兼容适配器，调用通用 renderer 后必须产生逐字相同的字符串。快照测试同时覆盖所有旧 motion。

### 6.2 8 个通用模板

canonical slug 使用：

1. `commerce-aesthetic-mood`
2. `commerce-ugc-testimonial`
3. `commerce-demo-first-reveal`
4. `commerce-single-feature-proof`
5. `commerce-unboxing-transform`
6. `commerce-value-proof`
7. `commerce-problem-solution`
8. `commerce-hard-sell-presenter`

模板均包含中英文行业标准名、motion、style lane、conflict angle、beats、叙事摘要、负向约束、样片元数据和 locked params。模板 prompt 必须包含 `{IMAGE_REFS}` 与 `{PRODUCT_NAME}`，渲染后不留占位符且长度不超过 5,000 字符。

### 6.3 SunnyShutter profile

SunnyShutter 的以下内容只在 profile 命中时叠加：

- plantation shutter 机械动作与 unsafe 正则。
- 产品几何锁。
- CEO hard-sell 风格和 CTA 结构。
- 固定联系电话、地址、Logo 角落和尾卡。

`BATCH_STYLE_TEMPLATE_SEEDS` 是 8 个通用模板与 SunnyShutter 客户模板的并集。普通客户不会继承 shutter 词汇。SunnyShutter 的旧 slug、版本和真实 v2 路径保持可用。

### 6.4 一致性抽卡

只泛化 `JUDGE_SYSTEM` 的产品措辞，不改候选数、并发、择优、超时或 fail-open 行为。公开 Shuyu 路径继续使用当前确定性首个成功候选策略；不得重新引入未审计平台 judge。

### 6.5 三处共用模板 ID

canonical slug 是产品层稳定 ID。数据库版本 ID 仍用于批量任务精确锁定版本，但 UI 和 URL 使用 slug：

- `/app/templates` 通过 slug 跳转。
- `/app/create?styleTemplate=<slug>`。
- `/app/batches/new?template=<slug>`，服务端解析当前 ACTIVE 版本并把数据库 ID 写入批次快照。

单条生成的 `resolveStyleTemplate` 通过 adapter 把 commerce template 转成现有 `StyleTemplate`/scaffold 结构，避免维护第二套提示词硬编码。顶部提示展示模板名和自动锁内容。

### 6.6 提示词打包

选择模板时，编辑框显示由模板元数据生成的人类可读创意 brief，而不是暴露供应商 promptSkeleton。无模板时，“帮我打包成规范提示词”使用确定性规则把用户白话、画幅、时长、零文字和参考图一致性组合成可编辑 brief。该按钮不调用 OpenAI，也不绕过后端模板锁。

## 7. P2 品牌资产化

### 7.1 数据模型

`WorkspaceBrandPackage` 增加 `isGlobal Boolean @default(false)`。`workspaceId` 继续必填，避免破坏现有关系和唯一约束。全局包由平台拥有的 workspace 管理，但所有用户可读取和选择。

服务层权限：

- `listWorkspaceBrandPackagesForUser` 返回当前 workspace 活动包与活动全局包。
- 当前 workspace 的默认包排在最前；全局包按名称排序。
- `findWorkspaceBrandPackageForUser` 允许读取自有包或全局包。
- 新建、编辑、删除和设默认只允许当前 workspace 自有包。
- 全局包在客户 UI 中只读，不能被客户设为 workspace 默认。

返回 DTO 增加 `isGlobal` 和 `canManage`。

### 7.2 SunnyShutter 全局包

seed 复用现有 SunnyShutter 品牌常量与已审计 Logo/尾卡资产。seed 必须幂等，不能把真实客户密钥或本地文件路径写入数据库。新账号和 demo 账号都能看见并选择该包；选择本身不触发生成。

### 7.3 品牌封装页面

新增 `/app/brand`：

- 全局“已服务客户”展示墙。
- 当前 workspace 品牌包列表。
- 新建、编辑、软删除、设默认。
- 上传 Logo、可选尾卡和联系方式。
- 复用 `logo-generator-dialog`，但 Logo 生成仍受现有供应商和账号权限约束。

导航新增“品牌封装”。删除采用 `isActive=false`，不物理删除仍被历史视频引用的品牌资产。

### 7.4 成品制作过程

成品详情服务增加可公开的制作证据 DTO：

- 当前故事板 4 帧缩略图。
- 抽卡候选数与择优说明。
- 模板名称、slug 和版本。
- 一致性锁的客户可读描述。

showcase 项目只读但允许下载。任何供应商 prompt、内部错误、签名 URL、积分或密钥不得进入 DTO。

## 8. P3 Shuyu 原生口播、字幕与 BGM

### 8.1 请求与脚本

`UnifiedVideoGenerationRequest` 增加：

```ts
audio?: {
  voiceover?: {
    enabled: boolean;
    voiceId: string;
    language: string;
    script: string;
  };
  bgm?: {
    trackId: string;
    volume: number;
  };
};
captions?: {
  enabled: boolean;
  style: "word_by_word" | "karaoke" | "plain";
  language: string;
  position: "top" | "center" | "bottom";
  exportSrt: boolean;
};
```

默认全部关闭，旧请求解析结果不变。

创意 plan 根据最终 creative brief 产生一份短口播初稿，前端在提交前允许编辑。启用原生口播时，最终脚本按 segment 时长拆分成带时间范围的 quoted dialogue，并写入 Shuyu prompt。`voiceId` 对应应用内审计的声音风格描述，不冒充 Shuyu 未提供的硬 voice ID。

### 8.2 Shuyu 契约

`ShuyuCreateVideoInput` 增加 `generateAudio: boolean`，请求体显式写入 `generate_audio`：

- voiceover 关闭：`false`。
- voiceover 开启：`true`，prompt 同时锁定 exact dialogue、语言、声音风格、自然环境音和“no music bed”。

Shuyu 的 `/health` 和 `/prices` 当前只声明 image/video，因此本轮不会新增虚构的 speech plan 或 TTS endpoint。真实验收先以一条低成本视频验证上游确实接受 `generate_audio`；如果 Shuyu 明确拒绝该字段，P3 以 fail-closed 状态交付，不能静默改走旧 Volc TTS。

### 8.3 字幕时间轴

Shuyu 任务只返回视频 URL，不返回逐字时间戳。字幕时间轴采用确定性算法：

1. 用 `ffprobe` 获取实际成片时长。
2. 按 punctuation 把最终脚本分句。
3. 按可见字符/词数和标点停顿权重分配句子时间。
4. `word_by_word` 在句内按词权重分配。
5. `karaoke` 使用当前词高亮和已读词弱化。
6. `plain` 每次显示一个完整短句。

时间轴始终由用户确认后的最终脚本生成，因此 `.srt` 与烧录文本一致。字幕算法不声称是 ASR 逐字对齐；本轮不引入另一个语音识别供应商。

### 8.4 BGM 与混音

首个可用曲库包含：

- `none`
- 仓库现有 CC BY 4.0 曲目 `Wholesome`，并在元数据与交付文档中保留署名。

目录结构允许以后增加有明确授权记录的曲目。不得把未知来源音频加入曲库。

ffmpeg 音频策略：

- 保留 Seedance 原生口播与环境音。
- BGM 循环并裁到成片长度。
- 用户 volume 限制为 `0..0.35`。
- 有口播时使用 sidechain compression/ducking；无口播时使用固定低增益。
- 混音后 `loudnorm` 到 `-16 LUFS`，true peak 不高于 `-1.5 dBTP`。
- 开头淡入、结尾淡出，最后输出 AAC。

字幕和 BGM 在 Logo/尾卡之前应用，Logo/尾卡不得覆盖字幕安全区。

### 8.5 外部 runner

Vercel 函数仍不直接执行长时间 ffmpeg。现有 stitch task/runner 合约扩展为携带经过 Zod 校验的 audio/caption plan。runner 负责：

- 下载输入视频和曲目。
- 生成 ASS/SRT。
- 烧录字幕并混音。
- 上传 MP4、thumbnail 和可选 `.srt`。
- 返回安全 URL。

失败时保留干净成片，任务状态标记为可诊断失败；不得把无字幕/无 BGM 的降级结果冒充完整成功。

## 9. 死卡物理清理

`scripts/cleanup-dead-library.ts` 默认只 dry-run。候选必须同时满足：

- 客户可见状态为失败或旧终态。
- 没有安全可播放 URL。
- 不属于 showcase source。
- 不属于 READY/SUCCEEDED 成片。

报告写入 `qa/evidence/dead-library-cleanup-<timestamp>.json`，包含记录 ID、标题、账号聚合、order/brief/finalVideo/videoJob/batch 数量和可安全定位的存储对象 key；不得包含密钥或签名查询参数。

只有显式 `--commit --evidence=<报告路径>` 且报告内容哈希匹配时才允许删除。真正执行前仍需用户再次确认。删除使用事务处理数据库关系，存储对象只删除能通过持久 `storageKey` 明确归属的对象；未知或供应商托管 URL记录为人工复核，不猜 key。

## 10. 错误处理与安全

- 所有 Shuyu 新字段都先经 Zod 校验，未知能力默认拒绝。
- 原生口播启用但脚本为空时阻止 dispatch。
- 字幕启用但口播关闭时仍允许用户提供脚本；脚本为空则阻止 dispatch。
- BGM trackId 必须来自服务端目录，客户端 URL 无效。
- 全局品牌包可读不可改，越权访问与不存在使用相同 404 语义。
- 物理清理永远默认 dry-run。
- 所有客户错误使用现有安全错误 envelope，不暴露 Shuyu、ffmpeg、积分或内部任务 ID。

## 11. 测试与验收

### 自动化

- 通用 shot policy 单元测试与 shutter 逐字快照。
- 8 模板 seed、占位符、长度和 unsafe 矩阵测试。
- 三处模板 slug 集合契约测试。
- SunnyShutter 与普通品牌隔离测试。
- 全局品牌包授权、排序、CRUD 和迁移测试。
- 制作过程 DTO 的 owner/showcase 安全测试。
- Shuyu `generate_audio` 请求契约测试。
- 字幕分句、逐字时间轴、ASS/SRT 转义测试。
- ffmpeg filter graph、ducking、响度和安全路径测试。
- 清理脚本候选选择、证据哈希和 `--commit` 门禁测试。
- `npm test`、`npm run typecheck`、`npm run lint`。
- 登录、批次列表、模板库、品牌页和成品详情的视觉与可访问性测试。

### 真实供应商

使用非 demo 验收任务：

1. 通用非窗帘产品经一个通用模板生成，prompt 不含 shutter 词。
2. SunnyShutter 通过原 profile 生成一条，保持 v2 路径和尾卡。
3. 生成一条英文原生口播视频：`generate_audio=true`、英文脚本、逐字字幕、Wholesome BGM。
4. 检查音画、字幕、ducking、Logo、尾卡、下载和 `.srt`。

所有真实调用前先运行 provider readiness 和余额检查，保存 sanitized 证据。demo 账号不用于付费生成。

## 12. 提交与合并

建议提交顺序：

1. `docs: define Aivora integration design`
2. `feat: tighten customer production surfaces`
3. `feat: add generic commerce template engine`
4. `feat: add global brand package showcase`
5. `feat: add Shuyu native audio post production`
6. `test: add Aivora integration acceptance coverage`

分支完成后提供：

- 自动化测试结果。
- 视觉截图路径。
- 真实供应商验收证据。
- 数据库迁移与回滚说明。
- 未执行的清理 dry-run 报告。

在这些材料经用户验收前，不合并 `main`。
