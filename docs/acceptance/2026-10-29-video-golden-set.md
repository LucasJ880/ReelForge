# 2026-10-29 · 视频评测集 v1 规程

来源：「Aivora 下一轮往哪走」文档的下一轮计划第 1 项——先把「好不好」变成能量的数，以后每一项出片链路的改动都先过它，分数不涨的不进生产。

工具：`scripts/eval/video-golden-set.ts`（驱动）、`scripts/eval/build-arm-prompts.ts`（在各版本工作区里出提示词）、
`scripts/lib/video-golden-set.ts`（纯逻辑，`tests/video-golden-set.test.ts` 守着）。用例：`scripts/eval/golden-set.cases.json`。

## 比什么、怎么保证公平

- **臂 = 一个 git 版本。** 驱动按版本建临时工作区（`git worktree`，默认放系统临时目录），用那一版的代码算故事板帧提示词与视频提示词；
  出图、出片、轮询、打分都走主仓库同一套代码。两臂之间只差「提示词怎么写」这一个变量。
- **同样的输入：** 同一组商品图、同一句商家原话、同一份固定口播稿（不让 AI 起稿的随机性混进来）、15 秒 9:16、无主播照。
- **同样的线路：** 默认线路 Shuyu，跑的时候的默认套餐（审计放行的 Seedance 2.5 · 720P 线路里最便宜的一档）；故事板帧 2K、GPT Image 2，与线上一致。
- **与线上同一条路径：** 出方案（`buildPlan`）→ 镜头卡 → 出帧计划 → 帧一张张出（第 N 帧带上第 N−1 帧）→ 按已确认故事板改写视频提示词 → 实拍在前、四帧在后作参考图出片。
  不做后期（字幕、拼接）：评的是生成质量。
- **每条每臂一个样本。** 出方案和镜头卡是 LLM 输出，有随机性；10 条只能看方向，差距小时换一个 run key 再跑一轮确认。
- **绝不碰数据库：** 驱动把 `DATABASE_URL` 换成连不上的地址，任何误用当场报错，碰不到生产库；不建订单、不占额度。

## 用例（10 个品类）

| id | 品类 | 拍什么 | 最容易翻车 |
| --- | --- | --- | --- |
| bottle | 保温杯 | 早上倒热茶装包 → 中午办公室打开冒热气 | 杯盖数量、特写变形、两个地点硬切、结尾兑现 |
| earbuds | 耳机 | 嘈杂地铁里戴上耳机，周围安静下来 | 戴进耳朵、充电盒形状、两只不多不少 |
| serum | 护肤精华 | 卸妆后滴两滴按在脸上 | 滴管与液体物理、镜中倒影 |
| tintTrio | 彩妆 | 玄关镜前试色，选珊瑚色出门 | 三支三色不串、涂上的颜色对 |
| watch | 手表 | 清晨露营看时间，背包出发 | 表盘乱码、比例、同一人同衣 |
| sneaker | 鞋 | 街头系鞋带，小跑过斑马线 | 左右脚一致、鞋带、凭空出现的标 |
| backpack | 户外背包 | 山路上开卷口拿外套，扣好继续走 | 卷口方向、外套来处、颜色卡扣 |
| pillow | 家居软装 | 空沙发放两个抱枕，抱一个看书 | 开头没抱枕、数量、布料受压 |
| coffee | 食品饮料 | 撕袋闻香、磨豆、冲一杯有油脂 | 素面袋没商标字、顺序、液体 |
| petToy | 宠物用品 | 金毛叼绳结跑来拔河，趴窝里啃 | 同一只狗、玩具只有一个、绳子两端 |

商品图是 2026-08-03 模板样片批次生成的商品照（无字无标）；抱枕那组第 1 张是空沙发场景，不当商品图用。

## 打分

六项各 0–2（0 明显不行 / 1 能看但有毛病 / 2 没毛病），盲评时改成「左更好 / 差不多 / 右更好」，最后选「整体更愿意直接发哪条」。

| 项 | 判断标准 |
| --- | --- |
| 前 2 秒钩子 | 前 2 秒有没有让人想看下去的东西（问题、反差、动作），而不是平淡的摆拍 |
| 商品一致 | 每个镜头都和参考照片一致：形状、比例、颜色、结构、印字；特写不变形 |
| 道具与物理 | 没有道具重复、凭空出现或消失；手、液体、蒸汽、布料合理 |
| 故事与兑现 | 按商家描述的顺序发生，结尾兑现卖点，没有前后颠倒 |
| 真实运动 | 每个镜头都有看得见的动作，不是静帧推拉、幻灯片 |
| 口播完整 | 有清楚的人声、整句说完不被截断；画外音时画面里没人对口型 |

- **AI 预评**（`score`）：每条成片每 1.8 秒抽一帧，8 张单帧（540 宽）连同商品照给看图模型，按前五项打分并写一句证据；口播那项看不了，只给音轨检查（有没有音轨、-30dB 以上有声多少秒、最后一段声音在第几秒结束——环境声也算有声，分不出人声）。**AI 分只作初筛，结论以人评为准**：
  10-29 用 10-28 保温杯 A/B 两条成片自测，AI 抓到了 A 臂结尾顺序颠倒、B 臂特写杯肩变宽，但漏了 A 臂约 9 秒处的两个杯盖，还把 B 臂「办公室开盖冒热气」的结尾判成没有；同一条换拼图 / 单帧、换严格口径，分数也会变。
  把 AI 看片做到能拦片，是下一轮第 2 项（成片质检）的事。
- **人评**（`report` → 盲评页）：左右顺序按 run key 随机，文件名不带版本；评完导出 JSON，`tally` 揭盲。揭盲汇总 `summary.md` 带版本名，评审人别看。

## 预先定下的判据（跑之前定，跑完不改）

- **新版通过：** 盲评「整体」一项，新版胜场 ÷（胜 + 负）≥ 70%，且决出胜负的不少于 7 条；
  并且「商品一致」「道具与物理」两项新版负场不多于胜场。
- **不通过：** 不进下一项；把输掉的用例和证据写进本页，改了再用新的 run key 跑。
- 两位评审（Evan、CEO）结论不一致时各自记录，以「整体」一项合计为准。

## 怎么跑

```bash
# 1. 用两个版本的代码算提示词（只调 LLM）
npx tsx scripts/eval/video-golden-set.ts prompts --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b
# 2. 干跑：看要花多少 Shuyu 点（不提交任何任务）
npx tsx scripts/eval/video-golden-set.ts run --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b
# 3. 真跑：过预算闸（上限、余额、7,000 点预留线）才提交；Ctrl-C 随时停，重跑续上；--retry-failed 把失败的放回去
#    新 run key 先加 --cases bottle 跑一对试水（Shuyu 常漂移，先确认帧、视频、下载整条通），再去掉 --cases 跑完剩下的
npx tsx scripts/eval/video-golden-set.ts run --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b --confirm-spend --max-points <上限>
# 4. 抽帧 + 音轨检查 + AI 预评
npx tsx scripts/eval/video-golden-set.ts score --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b
# 5. 盲评页（tmp/experiments-2026-11/golden-set/golden-1029/report.html，本地打开）
npx tsx scripts/eval/video-golden-set.ts report --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b
# 6. 揭盲
npx tsx scripts/eval/video-golden-set.ts tally --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b --votes ~/Downloads/votes-golden-1029.json
```

产物都在 `tmp/experiments-2026-11/golden-set/<run-key>/`（不进仓库）：每臂的 `prompts.json`、每条的 `*.record.json`（任务号、套餐、点数、时间）、
`*.mp4`、`*.sheet.jpg`、`*.score.json`，以及 `report.html`、`blind-key.json`、`summary.md`、`tally-*.md`。
临时工作区用完可以删：`git worktree remove <目录>`（目录名是版本号前 12 位）。

## 记录

### golden-1029（old = 3431ff4 改动前，new = 9cc6b2b 镜头导演 P0 上线版）

- 提示词（10-29）：两臂各 10 条，每条 40–75 秒（出方案 gpt-5.6-sol + 镜头卡 gpt-5.6-terra）。两臂 10 条都出了镜头卡、每条 4 帧，
  视频提示词 4.0k–4.3k 字，商品行都是看过商品图写的；新版每张卡都带首态与谁说话，保温杯（家 → 办公室）标了 1 次换地点。
- OpenAI 偶发技术失败三条：旧版 petToy 一致性设定空响应（退回启发式）；新版 tintTrio 看商品图时 OpenAI 下载 Blob 图超时（商品描述丢了）；
  新版 petToy 一致性设定与镜头卡设计都空响应（退回模板分镜）。三条各重算一次，都干净通过。
- 重算规则（出片前补定，两臂同用）：出提示词时日志里有 LLM / 看图技术失败的那一条重算一次；重算还失败就算系统性问题，
  原样保留（线上就是这么交付的）并记成缺陷。从不按好坏挑。
- 记成缺陷（线上同样会静默降级）：看图让 OpenAI 自己去拉 Blob 图，会下载超时；推理模型的 `max_completion_tokens` 含思考 token，
  一致性设定（1200）与镜头卡（2500）的上限可能偏紧——空响应是不是撞了上限，待查 `finish_reason`。
- 干跑（10-29）：80 张帧 × 32 点 + 20 条 15 秒视频 × 1,500 点（SY Seedance 2.5 特价 · 720P · 方案 113）= 32,560 点；
  余额 154,354 点，跑完约剩 121,794 点。
- 真机出片（10-29 Evan 批全量，上限 33,000 点，并发 2）：保温杯一对约 15 分钟出完（4 帧 9 分钟 + 视频 6 分钟），720×1280、15 秒、带音轨。
- 出片失败的处理（出片途中补定，人评开始前，两臂同用）：Shuyu 视频生成失败（`GENERATION_FAILED`、点数退回、原因不明、`retryable: false`）
  或提交 504 的，换新请求键重跑一次；再失败就记为「该臂该用例出片失败」，不进盲评，单独列出两臂各失败几条。
  第一轮失败三条：old/earbuds 与 new/serum 视频生成失败（画面里都有清楚的人脸，疑似上游审核，没有证据），old/serum 第 1 帧提交 504。
  停下后带 `--retry-failed` 续跑，预算按余额实际减少的 5,204 点扣，剩 27,796 点。
- old / new 两轮跑完（重跑前）：两臂都出片的只有保温杯、宠物玩具两对；旧版手表、旧版球鞋也成了。其余失败几乎都是画面里有人脸
  （生成阶段 `GENERATION_FAILED`、退点），另有提交时 `503 reference_validation_unavailable`（新版球鞋、旧版抱枕）、帧提交 504（新版手表）、
  帧轮询被晾（旧版口红，已修「先查后判超时」）。实扣约 11,336 点。按规则各重跑一次；决出胜负的对数注定远少于判据要求的 7 对，
  这一轮只能看方向，结论留给去掉人脸问题之后的下一轮。
- 10-29 加第三个版本 `kelin`（当前工作区代码，按 Kelin 团队做法改：全程英文、镜头卡六项、Shuyu 首帧版、人物设定图；
  见 `docs/roadmap/2026-10-29-kelin-workflow-lessons.md`）。对照组用 `new`（线上 9cc6b2b）已出的片，不重出基线。
  `kelin` 每条只出开场帧 + 有人或动物出镜时的人物设定图，再出视频（实拍 → 设定图 → 开场帧作参考）。
  写提示词的模型暂时仍是 OpenAI（还没有 Anthropic key），Claude 写的那一臂等 key 到了再加。
  提示词 10 条全干净（帧提示词零中文，视频提示词只剩口播台词一行，3.6k–4.0k 字）。首版判断「有没有人」漏了镜头卡的身份词
  （Passenger / Hiker / barista + their），耳机、背包、咖啡三条没出设定图；补词表后这三条重算（还没出片，不涉及按好坏挑）。
  干跑：20 张图 × 32 + 10 条视频 × 1,500 = 15,640 点；建议先跑耳机 + 保温杯两条试水（约 3,128 点）。
- `kelin` 试水（Evan 批 3,200 点）：两条都在 Shuyu 生成阶段失败、退点（保温杯 8.9 分钟、耳机 10.2 分钟；耳机第一次提交撞
  「参考图校验暂时不可用」，按 Shuyu 说的用同一个请求键重提）。实花只有 4 张图 128 点。
  **对照最清楚的一组**：保温杯在 old / new 两臂参考图没有正脸，都成功；`kelin` 只多了一张带清晰正脸的人物设定图，就失败。
  加上 old / new 两臂里画面有人脸的视频大多失败（耳机、精华、口红、背包、咖啡、抱枕），结论：**Shuyu 的 Seedance 2.5
  不接受写实正脸作参考图**（Shuyu 只回「原因不明」，没有书面说明）。Kelin 的「GPT 人物版 + Seedance 2.5」在这条线路上走不通。
- `kling` 臂（同一套做法改投 Shuyu 上的 Kling 4.0，方案 107，15 秒 780 点；开场帧排第一张、2,500 字以内；Evan 批 1,800 点）：
  耳机、保温杯两条的视频提交三轮都被当场拒，没扣点——`502 generation_failed`（「生成服务没能启动这个任务」）与
  `503 reference_validation_unavailable` 交替出现。最简探针（只带 1 张商品照、无人脸、5 秒）同样 502，
  所以是 **Shuyu 的 Kling 4.0 起不来**（价目表写着可用），不是我们的输入问题。只花了 4 张图 128 点。Kling 收不收正脸还没测到。
  Evan 再批探 Kling 3.0 Omni（方案 111）：同样的最简请求（3 秒）也是 `502 generation_failed`。同一时刻 Shuyu 健康检查回
  「operational、视频 available」，余额没动——**Shuyu 上的 Kling 整条线（4.0、3.0 Omni）17:50Z 前后都起不来**，健康检查不可信。
- 10-29 18:00Z 暂停：Evan 去问 Shuyu（Kling 502、校验 503、Seedance 是否拦写实正脸），修好再测。已出好的两对（保温杯、宠物玩具）
  放上远程盲评页 https://claude.ai/artifact/Nb3ta8bSPoCwj3ynpJpxhh（评分按评审各存一份、互相看不到）。

### golden-1029 恢复后怎么续跑

1. 先用真提交确认 Shuyu 好了（健康检查与价目表都不可信）。付费探针要 Evan 批。
2. old / new 失败的各重跑一次（旧版口红第 1 帧早已出好，续跑会先查到）：
   `npx tsx scripts/eval/video-golden-set.ts run --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b --retry-failed --confirm-spend --max-points 21600`
   （33,000 的批额减去已扣约 11,400）。旧版耳机、新版精华已重跑过一次，再失败就按规则记为出片失败。
3. Kling：开场帧与人物设定图都已出好，只差视频（剩余批额 1,672 点）：
   `npx tsx scripts/eval/video-golden-set.ts run --run-key golden-1029 --arms kling=. --cases bottle,earbuds --retry-failed --confirm-spend --max-points 1672`。
   换套餐（如 3.0 Omni 方案 111）要新建一臂再出提示词（`prompts --arms <新臂>=. --cases bottle,earbuds --kling-plan video-plan-111`），
   别在同一臂里改套餐——请求键会串到旧套餐的单上。
4. `score` → `report` → 把新出好的成片对（`review/<case>-L/R.mp4`）与商品照（`product-photos/<case>-<n>.jpg`）作为资源传到盲评页，
   返回的 `/_blob/` 地址记进 `tmp/experiments-2026-11/golden-set/golden-1029/remote-assets.json` →
   `npx tsx scripts/eval/build-review-page.ts tmp/experiments-2026-11/golden-set/golden-1029` → 用生成的 `remote-review.html` 更新上面那个 Artifact。
5. 揭盲：读盲评页数据库的 `votes` 集合（每位评审一条，`isOwner` 标出 Evan），存成 `{runKey, reviewer, votes}` 的 JSON，跑 `tally`。
