# Aivora 展台套件 · 局域网中继 / Booth kit · LAN relay

`relay.mjs` 让展台上的 2–3 台设备（扮演客户手机的 iPad、老板控制台、大屏）**不靠外网**互相同步，
并承接扫码结果页的 session 与留资表单。零依赖，只要 Node 18+。

`relay.mjs` keeps the 2–3 booth devices (iPad as the customer's phone, owner console, big screen)
in sync **without internet**, and backs the QR result page (sessions + lead form). Zero dependencies, Node 18+.

## 开展前 · Before the doors open

```bash
node designs/aivora-v2-exchange/booth/tools/relay-selftest.mjs   # 前一晚跑一次，应全绿 / run the night before, expect all ok
node designs/aivora-v2-exchange/booth/relay.mjs                  # 默认端口 4317 / default port 4317
```

1. **自带网络。** 展馆 Wi-Fi 通常开着「客户端隔离」，设备之间互相看不见。用随身路由器或手机热点，
   笔记本和所有展台设备连同一个网络。
   **Bring your own network.** Venue Wi-Fi usually isolates clients. Use a travel router or a phone hotspot
   and put the laptop and every booth device on it.
2. 启动后终端会打印每个局域网地址，例如 `http://192.168.1.23:4317/booth/index.html`；
   在每台设备的浏览器里打开它（`/` 也会跳到这里）。macOS 弹出防火墙提示时点「允许」。
   The relay prints one URL per LAN address; open it on each device (`/` redirects there).
   Click "Allow" if macOS asks about incoming connections.
3. 设备角标显示「展台局域网已配对 / Paired over booth Wi-Fi」即连通。中继断了页面会自动重连，
   断线 2 分钟内漏掉的消息会补发。
   The badge "Paired over booth Wi-Fi" means it works. Pages reconnect by themselves and
   messages missed during a drop (≤ 2 min) are replayed.
4. iPad：关闭自动锁定，开「引导式访问」锁在页面上。
   iPad: turn off Auto-Lock and use Guided Access to pin the page.
5. 大屏打开 `screen.html?fitcheck`，底部显示 **FIT OK** 再去掉参数正式轮播；显示 FIT FAIL 时它会列出被裁切的元素。
   Open `screen.html?fitcheck` on the real big screen; it must read **FIT OK** (otherwise it lists what is clipped).
6. 用一台关掉 Wi-Fi、只用 4G/5G 的手机扫店主台二维码，提交一条测试留资，确认 `leads.jsonl` 或线上库里真的有。
   With Wi-Fi off on a phone, scan the owner QR, submit a test lead and confirm it was stored.

> **访客扫码 / Visitor QR:** 默认二维码指向笔记本的局域网地址，只有连上展台 Wi-Fi 的手机打得开，走 4G/5G 的打不开。
> 开展前在 `booth/config.json` 的 `resultBase` 填结果页公网地址（把 `booth/` 和 `/api/lead` 一起部署到我们自己的域名），
> 二维码就会改用自包含链接（`?d=`），任何网络都能打开。留资提交失败时，页面如实告诉访客「没有提交成功」，
> 并给出 `leadFallback` 里的邮箱 / WhatsApp / 微信，不会假装已经收到；手机断网时表单保留，回到有网时自动再发一次。
> `consentEntity`（法律主体名称 + 邮箱）没填时，结果页不开放线上登记，只显示联系方式。
> By default the QR points at the laptop's LAN address, which phones on 4G/5G cannot reach. Before the fair set `resultBase`
> in `config.json` (deploy `booth/` and `/api/lead` to our own domain); the QR then uses a self-contained `?d=` link.
> If a lead can't be sent, the page says so and shows the `leadFallback` contacts; offline phones keep the form and resend once back online.
> Without `consentEntity` (legal name + email) the result page shows contacts only and collects no consent.
>
> **网络安全 / Network:** 总线不做鉴权，同一 Wi-Fi 上的设备都能往大屏推文字（页面会转义，不会执行脚本）。
> 展台网络一定要设密码，不要用开放的访客 Wi-Fi。
> The bus has no auth by design: anything on the booth Wi-Fi can push text to the big screen (escaped, never executed).
> Use a password-protected booth network, never open visitor Wi-Fi.

## 线索数据 · Lead data

- 存在 `~/.aivora-booth/leads.jsonl`（每行一条 JSON，文件权限仅本人可读），**永远不在仓库里**；
  `--data-dir` 指到仓库内会被拒绝。Session 在同目录的 `sessions.jsonl`，中继重启后二维码链接仍有效。
  Stored in `~/.aivora-booth/leads.jsonl` (one JSON per line, owner-only permissions), **never in the repo**
  (a `--data-dir` inside the repo is refused). Sessions live next to it in `sessions.jsonl` and survive restarts.
- 只保存**勾选了同意**的联系方式（邮箱 / WhatsApp / 微信各自单独勾选）：填了却没勾，那一项会被丢弃。终端日志只打计数，不打联系方式。
  Only contacts **with their own consent ticked** (email / WhatsApp / WeChat) are stored; the log shows counts only.
- 店员在店主台记的两个标签（客户现在怎么接询盘 + A/B/C 代号）存在 iPad B 本机，店主台底部「复制今天的店员标签」可以导出。
  导出里的 `sid` 与结果页提交的线索里的 `sid` 是同一个，两边可以对上。
  Staff tags live on iPad B; export them with "Copy today's staff tags" at the bottom of the owner page.
  Their `sid` matches the `sid` on leads submitted from the result page.
- 每天收展后把文件拷进 CRM 并归档。 Copy the file into the CRM at the end of each day and archive it.

## 参数 · Options

| flag | default | |
|---|---|---|
| `--port` | `4317` | `0` = 随机空闲端口 / random free port |
| `--host` | `0.0.0.0` | 监听所有网卡 / listen on every network |
| `--data-dir` | `~/.aivora-booth` | 也可用 `AIVORA_BOOTH_DATA` / or `AIVORA_BOOTH_DATA` |
| `--rate` | `60` | 每台设备每分钟 `/api/*` POST 上限，`/bus/send` 为 10 倍 / per-device POSTs per minute |
| `--allow-host` | — | 额外允许的主机名（逗号分隔）；默认只认 IP、localhost、`*.local` 和本机名 / extra Host names to accept |
| `--verbose` | off | 记录每条总线消息的类型和大小（不记内容）/ log bus message type + size, never payload |

## 接口 · API (for page authors)

| route | |
|---|---|
| `GET /bus/ping` | `{ok:true, relay:"aivora-booth", version:1}` |
| `GET /bus/events?room=booth` | SSE；每条消息一行 `data:`，15 s 心跳注释；发送者自己也会收到（按 `id` 去重）/ sender gets its own echo |
| `POST /bus/send?room=booth` | JSON ≤ 16 KB → 广播给该房间所有订阅者 / broadcast → `204` |
| `POST /api/session` | JSON object ≤ 8 KB → `201 {id}`（8 位 base32） |
| `GET /api/session/<id>` | 原样返回 / the stored JSON, or `404` |
| `POST /api/lead` | `{lang, sid?, email?, whatsapp?, wechat?, consentEmail, consentWhatsApp, consentWeChat?, note?}` ≤ 4 KB → `201 {ok:true}`；否则 `400 {ok:false, error, field?}`，`error` ∈ `invalid_field` `contact_required` `consent_required` `too_deep` |
| `GET /api/info` | 局域网 origin 列表 + 计数（无个人信息），可用来生成二维码 / LAN origins + counts, handy for building the QR link |

房间名 `[a-z0-9-]{1,32}`。API 只收 `Content-Type: application/json`。CORS 只放行同源和私有局域网 / 回环 / `.local` 来源，
其他来源 `403 origin_not_allowed`；未知主机名 `421`（防 DNS rebinding）；同一设备 SSE 超过 16 路 `503`；
查不存在的 session 每分钟超过 30 次 `429`。静态文件只发 `designs/aivora-v2-exchange/` 下的网页资源
（视频支持 Range 拖动），不列目录、不发隐藏文件。页面请从中继地址打开，不要用 `file://`。
Room names `[a-z0-9-]{1,32}`. JSON only. CORS is limited to same-origin and private-LAN / loopback / `.local` origins
(`403 origin_not_allowed` otherwise); unknown Host → `421`; >16 SSE streams per device → `503`; >30 unknown session
lookups per minute → `429`. Open pages via the relay URL, not `file://`.

## 改了页面文字之后 · After editing page text

```bash
python3 designs/aivora-v2-exchange/booth/tools/build-fonts.py          # 重建中文与符号子集（需联网）/ rebuild CJK + symbol subsets (network)
python3 designs/aivora-v2-exchange/booth/tools/build-fonts.py --check  # 离线检查：页面里的字是否都有字形 / offline coverage check
node designs/aivora-v2-exchange/booth/tools/build-icons.mjs            # 新增图标名后重建 / after adding icon names
node designs/aivora-v2-exchange/booth/tools/draft-cases.mjs            # 改了草稿库规则后跑中英繁回归用例 / draft library regression
```

## 故障排查 · Troubleshooting

- **端口被占 / port busy** → `--port 4318`。
- **设备连不上 / device can't connect** → 同一网络？防火墙允许 node？路由器关掉 AP 隔离。 Same network? Firewall allows node? AP isolation off?
- **笔记本换了网络 / laptop switched networks** → 不用重启，中继监听所有网卡；重启只为了看新地址。
  No restart needed (it listens on every interface); restart only to see the new URLs printed.
- **视频不能拖动 / video won't seek** → 通过中继地址打开，不要直接双击 HTML 文件。 Open via the relay URL, not by double-clicking the file.
- **店主台显示「客户手机还没收到」/ owner says "not delivered"** → 点「重发」；还不行就看两台 iPad 的角标是否都是「已配对」。
  Tap Resend; if it persists, check both iPads show "Paired".
- **一轮没结束又有人开始 / a new visitor starts mid-round** → 店主台会提示「下一位已就绪」并替他留着留言，点「结束本轮」或「下一位」就接上。
  The owner page queues the next visitor (and their comment); End round / Next visitor picks it up.
- **停止 / stop** → `Ctrl+C`（会先写完数据再退出 / flushes data before exiting）。
