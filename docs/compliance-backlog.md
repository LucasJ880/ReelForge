# Compliance and platform backlog

## Legal and privacy

- 加拿大律师复核并定稿 Privacy Policy 与 Terms of Service，确认责任限制、赔偿、适用法律与终止条款。
- 在任何外部客户走 Volcengine `cn-beijing` 临时视频生成路由前，更新第三方处理方与跨境披露：列明传输的 brief、图片/视频素材、派生提示词与返回成片，处理目的和区域，provider 保存/删除口径、合同安全措施及客户通知/选择机制；由加拿大律师复核。
- 为 `cn-beijing` legacy profile 建立临时例外登记：业务 owner、启用日期、复审/退出日期、适用账号与批次、回切 BytePlus 国际路径的条件。到期未复审不得把该路径描述为永久默认。`ASSUMPTION: 当前尚无人工确认的截止日期。`
- 人工确认 `NEXT_PUBLIC_PRIVACY_EMAIL` 指向真实有人监控的邮箱；当前工程草稿显式展示该假设。
- 为 PIPEDA 访问、导出与删除请求建立 internal 工单和可审计执行工具；定义客户记录、作业日志、媒体与安全日志的具体保存期限。
- 如向欧盟用户提供服务，评估 EU AI Act Article 50 的透明度要求；当前播放器标签与可选片尾卡是技术基础，不等于法律结论。
- 如发送营销邮件，落实 CASL 明示同意、证据保存和一键退订。

## Content review

- 为用户上传视频接入复用 QA ffmpeg 管线的定时抽帧；在此之前，真实审核模式下没有预览帧的视频会 fail-closed 进入人工复核。
- 为成片审核增加多帧而非单缩略图采样，并定义抽样覆盖率与误报复审 SLO。

## Object access

- 将当前 Vercel Blob `Public + random URL` 访问模型升级为受控访问（私有对象、短期签名 URL 或鉴权代理），并制定 URL 轮换与撤销策略。

## Digital human

- 为 Volcengine TTS 与 OmniHuman 选择北美可用替代方案；需重新评估数据区域、SLA、价格与内容披露后，才能重新开启 feature flag。

## Provider configuration cleanup

- 活动 env 示例已移除 digital-human provider 变量；人工需从本地/托管环境清理不再使用的旧 provider secrets。若未来重启该产品能力，使用单独的 provider 选型、数据路由与预算 Gate。
- 临时 Volcengine `cn-beijing` 视频 profile 只允许通过既有 `VideoProvider` 切换面启用；不得扩散为 LLM/TTS/OmniHuman/审核/存储默认。BytePlus 国际 adapter 保留，legacy 例外结束后应按演练过的配置回切并撤除不再需要的旧凭证。

## Buddy provider

- 等对方提供官方 API 文档、认证、异步状态机、错误码、幂等、并发、数据区域、SLA 与计费口径后完成 SL-A；本轮不得依据同行私有页面或截图逆向契约。
- 只有 `confirmed_unit_price` 与账户积分两项人工证据齐全，才允许真实调用。托管密钥名称固定为 `shuyu_api_key`。
