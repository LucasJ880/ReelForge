# B1 · 产品锚定界面入口 UI 验收（2026-08-03）

真实用户视角走完整流程：品牌页「锚定这个产品」→ 上传 → 框选 → SKU → 提交 → 状态列表。
账号 `final-acceptance@aivora.app`（phase34 验收账号，非 demo）；抠图走真实 remove.bg，
无 mock。此前 B1 服务层只能由 agent 脚本代建（见 b1-acceptance-2026-08-03.md），
本次补齐并验收商家自助入口。

## 判定：PASS（含 2 个真机抓出的缺陷，当场修复后复验通过）

| # | 场景 | 结果 |
|---|---|---|
| 1 | demo 账号提交 | ✅ 403 `DEMO_BLOCKED`，弹层内展示原因，零副作用（网络实抓） |
| 2 | 上传→框选→SKU→提交（餐桌场景照，框选罗马帘） | ✅ 锚点落库 FAILED + 可读 failureReason，界面给「重试抠图」出路 |
| 3 | 产品照（蜂巢帘）+ 框住产品 | ✅ READY：真 RGBA 切片（351×711，背景透明 19%）+ mask 落 blob，`cutoutProvider=remove_bg` |
| 4 | 错主体拒绝（场景照全图抠出餐桌椅） | ✅ FAILED：「抠出的主体只有 0% 落在框选区域内…」——覆盖率校验确定性抓住错主体，不做假成功 |
| 5 | FAILED 原地重试（界面按钮） | ✅ `POST /api/product-anchors/[id]/retry → 200`，不重新上传 |
| 6 | 刷新持久化 | ✅ 服务端渲染列表与客户端状态一致 |
| 7 | 弹层取消 | ✅ 随时可退，素材保留（铁律 #7） |

READY 锚点：`cmscmqk7k000bliopr4t261iy` · sku `sunnyshutter-honeycomb-shade-ui` ·
[切片](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/product-anchors/cmscmqk7k000bliopr4t261iy/cutout.png)

## 真机抓出的缺陷（本次修复）

1. **remove.bg roi 只认整数百分比**：`"23.79% 20.31% …"` → `HTTP 400 invalid_roi`。
   修复：起点向下、终点向上取整（框只放大不缩小）。单测钉住。
2. **贴边产品加 roi 后整体检测失败**：窗帘/百叶整窗照（本品类主力）连**近全幅框**
   （3%→98%）都报 `unknown_foreground`，而全图抠成功——roi 不能当唯一手段。
   设计修正：roi 优先 → 被拒时退回全图抠 → **框内覆盖率 ≥70% 事后校验**
   （`maskCoverageInBox`）。框从检测约束改为确定性校验器：场景照抠出框外餐桌椅
   → 覆盖率 0% → 拒绝（见 #4），产品照全图抠 → 覆盖率达标 → READY（见 #3）。
3. **竖幅产品图撑爆框选区**（390×790 实测无法一次框完）：框选区宽度按比例钳到
   52vh 等效值，整弹层一屏可操作。

## 已知边界（不阻塞）

- remove.bg 对「无明显物体轮廓」的平面产品区域（纯帘面小框）不识别；商家侧
  出路已在界面上：框大一点（含产品完整轮廓）或换产品照，failureReason 附
  remove.bg 支持图片说明链接。
- Clipdrop 线路无 roi 等价参数，覆盖率校验同样兜底。
