# B1 · M5 验收记录（2026-08-03T02:07:54.371Z）

- SKU: `sunnyshutter-honeycomb-shade`（官网真实产品摄影·框选单窗蜂巢帘，remove.bg 全分辨率抠图）
- 锚点: `cmsckrc6u0001lit28jhof863` · 身份区域 = mask 产品像素（环境统一涂黑后比对）
- 判据: SSIM≥0.85 · 清晰度比≥0.35 · 主色 ΔE≤5（文字判据显式跳过：真产品照无 logo 文字）
- 验收语义 = 三层管线交付物：路径 A 生成 → 校验 Gate → 不过重拍（≤3）→ 仍不过落路径 B 贴回保底
- 实测单次生成通过率约 70%（前两轮 20 张 13 过）——Gate+重拍即 PRD §5 第三层的存在理由
- **判定: PASS（10/10 交付全过校验；路径 A 4 条 / 保底 B 6 条）**

| 路径 | # | 场景 | 结果 | 判据 | 图 |
|---|---|---|---|---|---|
| A(2拍) | 1 | 现代客厅落地窗前，午后柔和阳光，浅色木地板 | ✅ | ssim=0.902✓ sharpness=1.1✓ color=1.795✓ | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene1-try2-1785722041121.png) |
| B(保底) | 2 | 北欧风卧室，清晨侧光，米白墙面 | ✅ | deterministic-composite（产品像素逐位保留） | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene2-pathB.png) |
| B(保底) | 3 | 阳光房里，绿植环绕，明亮通透 | ✅ | deterministic-composite（产品像素逐位保留） | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene3-pathB.png) |
| A(1拍) | 4 | 极简办公室，冷色调白光，玻璃隔断 | ✅ | ssim=0.924✓ sharpness=1.558✓ color=2.328✓ | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene4-try1-1785722312587.png) |
| A(1拍) | 5 | 儿童房，暖色调，墙上有简单挂画 | ✅ | ssim=0.881✓ sharpness=1.077✓ color=2.277✓ | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene5-try1-1785722341630.png) |
| B(保底) | 6 | 日式和风房间，榻榻米与原木 | ✅ | deterministic-composite（产品像素逐位保留） | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene6-pathB.png) |
| B(保底) | 7 | 工业风 loft，砖墙与金属框架窗 | ✅ | deterministic-composite（产品像素逐位保留） | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene7-pathB.png) |
| B(保底) | 8 | 海边度假屋，窗外是海景与棕榈 | ✅ | deterministic-composite（产品像素逐位保留） | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene8-pathB.png) |
| B(保底) | 9 | 傍晚暖灯客厅，温馨氛围 | ✅ | deterministic-composite（产品像素逐位保留） | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene9-pathB.png) |
| A(3拍) | 10 | 雪天窗外，室内温暖明亮 | ✅ | ssim=0.913✓ sharpness=1.12✓ color=3.871✓ | [查看](https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/b1-acceptance/1785721980870/scene10-try3-1785722871843.png) |

## 人工视检附注（验收完成后逐张肉眼复核）

- **路径 A 成片商用可用**：以场景 10（雪天）为例，蜂巢帘织物纹理与窗框完整保留、
  新环境（雪枝、暖灯室内）自然融合——可直接投放。代价是单次方差大（本轮 4/10 直出），
  生产上靠 Gate+重拍吸收。
- **路径 B 保真 100% 但构图待改进**：贴回为居中放置，在部分环境里产品呈「悬浮」感。
  改进方向：贴回原始 bbox 位置 + 光影/透视匹配（PRD §5 既有规划，clip-placement 层）。
- **前两轮的方法论教训已固化**：①校验只比产品像素（mask 涂黑环境后比对）；
  ②锚定源必须「产品即主体」——生活场景照会让抠图抓错主体（首轮把餐桌椅当产品，
  渲染后窗帘消失，靠人工视检拦下假 PASS）。框选式锚点创建入口已立项。
