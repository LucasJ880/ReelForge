# Aivora · 中国大陆合规上线 Readiness

> 本文档不是"上线就完事"的待办清单，而是「公开上线前所有合规事项 vs 当前完成度」的对照表。
> Phase 1（本次迁移）只完成了技术准备，**合规事项绝大多数还没做**，请上线前逐项核对。

## 0. 合规阶段划分

| 阶段 | 受众 | 合规要求 |
|---|---|---|
| **A. 内部 demo** | 公司内部 / 投资人 / 少数客户 | 无对外宣称；服务器在境内即可，备案可后置 |
| **B. 客户私域试用** | 已签约的 B 端客户（POC） | 需要 ICP 备案；需要基础内容审核 + 隐私政策 |
| **C. 公开测试 / 商业化** | 公开注册 / 公开访问 | 需要 ICP + 公安联网备案 + 全套合规材料 + 内容审核 + 用户协议 + AI 生成内容声明 + 留痕系统 |

本 Phase 1 让 Aivora **具备进入 A 阶段的能力**；进入 B / C 需补完下方各项。

---

## 1. ICP 备案

**必须**。中国境内服务器对外提供 web 服务必须备案。

- 主体类型：企业（个人备案不能跑商业网站）
- 申请通道：火山/阿里云/腾讯云任一备案系统
- 周期：7-20 个工作日（首次较慢）
- 状态：⚠️ 未办理（启动 demo 前可不办，公开访问前必须办）

## 2. 公安联网备案

**必须**。ICP 备案通过后 30 个工作日内办理。
- 通道：[全国互联网安全管理服务平台](https://www.beian.gov.cn/)
- 需要：ICP 号 + 网站负责人身份证 + 公司营业执照 + 备案承诺书
- 状态：⚠️ 未办理

## 3. 隐私政策 & 用户协议

**必须**。任何收集用户信息（包括 email / 手机号 / 上传素材）的产品都要。

- 必备内容：
  - 收集哪些个人信息（明示）
  - 用途（明示且不超范围）
  - 保存期限
  - 删除方式
  - 第三方共享（火山方舟会处理用户上传的素材 + prompt）
  - 跨境传输（如果有；本项目原则上**不**跨境）
  - 联系方式 / 投诉渠道
- 显示位置：注册页、登录页、上传页脚部链接
- 状态：⚠️ 未实现（目前无隐私政策页面）

## 4. AI 生成内容声明

**必须**（《生成式人工智能服务管理暂行办法》）。

- 必备元素：
  - 用户输入界面提示"由 AI 生成"
  - 生成内容上**显式水印**或角标（GenAI 法规要求）
  - 后台留痕：保存 prompt、模型、生成时间、操作人
- 当前实现：
  - ✅ `src/components/demo/compliance-note.tsx` 已存在（仅 demo 页面）
  - ⚠️ 视频成品没有自动水印
  - ⚠️ 没有统一的"AI 生成"角标组件
  - ✅ `AnalysisReport` / `UsageLog` 已有审计字段，可扩展
- 待办：
  - [ ] 视频拼接最后一帧自动加 "AI 生成 · Aivora" 角标
  - [ ] 后台留痕表（已有 `UsageLog`、可补 `ContentGenerationAudit`）

## 5. 内容审核机制

**必须**。

- 当前实现：
  - ✅ 抽象接口已就位（`lib/content-review/`）
  - ✅ Noop / Volcengine provider 骨架
  - ⚠️ Volcengine provider 是 placeholder（throw not implemented）
  - ⚠️ **未在业务流中实际调用**（generation-supervisor / upload route 还没插入 reviewTextOrThrow）
- 待办（公开测试前）：
  - [ ] 接入火山引擎内容审核 API（图片/文本/视频）
  - [ ] 在 `src/app/api/upload/blob/route.ts` 上传后调 reviewMediaOrThrow
  - [ ] 在 `src/lib/video-generation/generation-supervisor.ts` submit 前调 reviewTextOrThrow(prompt)
  - [ ] 在 video-service finalize 后调 reviewMediaOrThrow(rendered_url)
  - [ ] 配置敏感词库 + 业务回调（拒绝时友好提示用户）

## 6. 用户举报入口

**必须**。

- 实现建议：
  - 视频详情页 / 个人作品页 加"举报"按钮
  - 后台 internal 队列：`/internal/reports`
  - 状态：⚠️ 未实现

## 7. 后台人工审核

**必须**（生成式 AI 法规要求"人工干预机制"）。

- 当前实现：
  - ✅ `/internal/qa` 已有，但目前是 AI QA + 人工放行流程
  - 待补：
    - [ ] 用户提交内容前置审核队列
    - [ ] 紧急拦截功能（一键 takedown）
    - [ ] 审核员账号 + 操作日志

## 8. 操作日志和生成记录留痕

**必须**。

- 当前实现：
  - ✅ `UsageLog` 表已存在，记录 AI 调用
  - ✅ `VideoJob` 完整记录 prompt / status / 失败原因
  - ✅ `prisma/schema.prisma` 大部分实体都有 createdAt / updatedAt
  - ⚠️ 缺失：用户登录日志、关键操作（删除作品、修改信息）的审计日志
- 留存期限：建议至少 6 个月（按法规要求）

## 9. 数据存储位置

**必须**。

- 当前实现：
  - ✅ DATABASE_URL 指向境内 RDS（部署文档已说明）
  - ✅ 对象存储用境内 TOS
  - ✅ Logs 留在境内 ECS / 火山观测云
  - ⚠️ AI 模型调用：豆包是火山方舟，**境内不出境**；OpenAI 不应在国内启用
- 隐私政策中需明示「数据存储在中国大陆境内，不跨境传输」

## 10. 未成年人保护

**B / C 阶段必须**。本项目主要面向 B 端，但如果开放 C 端：
- 注册时声明"未满 18 岁需监护人同意"
- 防沉迷 / 内容分级
- 拒绝处理涉及未成年人的素材（火山审核已有相关分类）

## 11. 企业 vs C 端差异

| 维度 | 企业版（POC） | C 端 / 公开 |
|---|---|---|
| ICP | 必须 | 必须 |
| 公安联网 | 必须 | 必须 |
| 内容审核 | 推荐（合同里约定） | 必须 + 严格 |
| 实名认证 | B 端走对公开通可不做 | 必须（手机号 + 实名） |
| 隐私政策 | 必须 | 必须，且更严格 |
| 内容评级 | 通常不需要 | 必须（暴恐/色情/政治拦截） |
| 7×24 客服 | 推荐 | 必须 |
| 内容投诉 7 日内响应 | 推荐 | 必须 |

---

## 12. Phase 1 Done + Phase 1 Not Done

**Done（结构性准备）**：
- ✅ Provider 抽象层（AI / Storage / Video / ContentReview）
- ✅ 中国大陆环境变量模板（.env.china.example）
- ✅ Docker 部署路径（Dockerfile + docker-compose）
- ✅ ECS 部署文档（CHINA_DEPLOYMENT.md）
- ✅ Health endpoint（不泄漏敏感信息）
- ✅ env validation 在 region=cn 时校验必备 vars
- ✅ 合规文档骨架

**Not Done（业务流接入 + 真实合规）**：
- ❌ 火山内容审核真实接入（provider 占位）
- ❌ 业务流中实际调用 reviewTextOrThrow / reviewMediaOrThrow
- ❌ ICP 备案 / 公安联网备案
- ❌ 隐私政策 / 用户协议页面
- ❌ AI 生成内容水印
- ❌ 用户举报入口
- ❌ 后台人工审核队列
- ❌ 短信登录
- ❌ 微信/支付宝支付

下一阶段（Phase 2）建议优先级：内容审核接入 > 备案 > 隐私政策 > 水印。
> **非当前路线图，仅作未来参考。未来出海预留，当前不维护。**
