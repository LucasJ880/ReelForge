# 中国部署历史归档

> 未来出海预留，当前不维护。

本目录保存此前基于错误部署语境产出的中国大陆配置、部署文档、合规草稿和未实现的内容审核 provider 骨架。Aivora 当前公司与运营地在加拿大，服务部署、数据库与对象存储以北美为准；这些文件不得作为当前部署依据，也不参与主应用编译。

若未来启动中国市场项目，须由独立法律实体、独立路线图与人工法律审查重新评估，不得直接恢复这些历史文件。

## Phase 1 digital-human 封存

以下内容因依赖中国区 Volcengine TTS / OmniHuman 被移出活动运行时：

- `code/volc-tts.ts`、`code/omnihuman.ts`：原 provider 完整实现。
- `scripts/`：旧 digital-human/OmniHuman demo 与 runner。
- `workflows/digital-human-render.yml`：旧外部 runner workflow。
- `assets/aivora-digital-human-pet-store-30s-9x16.mp4`：旧 demo 成片。

主干同名 provider 文件仅为 fail-closed 兼容 stub，不含网络实现；所有 API、service create/claim/complete 与 pipeline 入口均由不可配置的 sealed guard 阻断。
