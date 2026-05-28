# Aivora 中国大陆部署指南（火山 ECS + Docker + RDS + TOS）

> **目标**：让运维 / 部署同学拿着这份文档，在一台空的火山 ECS 上把 Aivora 跑起来，
> 并且数据库走火山 RDS，对象存储走火山 TOS，视频生成走火山方舟 Seedance。
>
> 本文档不替代 `docs/DEPLOYMENT.md`（海外 Vercel）；二者并存，业务代码通过环境变量切换。

## 0. 前置准备清单

| 资源 | 必须 | 说明 |
|---|---|---|
| 火山 ECS（Ubuntu 22.04 LTS 或 24.04 LTS，2C4G+） | ✅ | 推荐 4C8G，国内 region（cn-beijing / cn-shanghai） |
| 火山 RDS PostgreSQL（13/14/15+） | ✅ | 与 ECS 同 region；开启 SSL；同 VPC 内网连接 |
| 火山 TOS（对象存储）2 个 bucket | ✅ | `aivora-cn-uploads` / `aivora-cn-renders`；默认私有 |
| 火山方舟 Ark API Key + 接入点 | ✅ | 至少开通：豆包文本（Doubao-Pro）+ Seedance 视频（doubao-seedance-2-x） |
| 域名 + ICP 备案 | ✅（公开访问必须） | 备案最短 7-20 天，建议提前申请 |
| SSL 证书（HTTPS） | ✅ | 推荐免费 Let's Encrypt 或火山 SSL |
| 火山 IAM 子账号 | 推荐 | 最小权限：TOS 读写 + Ark 调用 + RDS 不需要 |
| 火山内容安全（Content Moderation） | 可选（Phase 1 不必须） | 公开测试前必备 |
| 阿里云 / 火山 SMS | Phase 2 | 短信登录（Phase 1 用邮箱密码） |

## 1. 环境变量

参考 `.env.china.example`。最小必填集合（demo 起跑）：

```bash
REGION=cn
DEPLOYMENT_TARGET=china
APP_BASE_URL=https://demo.aivora.cn
NEXT_PUBLIC_APP_URL=https://demo.aivora.cn
NEXTAUTH_URL=https://demo.aivora.cn

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/aivora?sslmode=require
AUTH_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 16)

AI_PROVIDER=volcengine
STORAGE_PROVIDER=volcengine_tos
VIDEO_PROVIDER=volcengine

VOLCENGINE_ACCESS_KEY_ID=...
VOLCENGINE_SECRET_ACCESS_KEY=...
VOLCENGINE_REGION=cn-beijing

VOLCENGINE_ARK_API_KEY=...
VOLCENGINE_ARK_MODEL_TEXT=doubao-pro-32k
VOLCENGINE_ARK_MODEL_VISION=doubao-1.5-vision-pro-32k

ARK_API_KEY=...           # 与 VOLCENGINE_ARK_API_KEY 可以相同
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL=doubao-seedance-2-0-260128

VOLCENGINE_TOS_ENDPOINT=tos-cn-beijing.volces.com
VOLCENGINE_TOS_REGION=cn-beijing
VOLCENGINE_TOS_BUCKET_UPLOADS=aivora-cn-uploads
VOLCENGINE_TOS_BUCKET_RENDERS=aivora-cn-renders

VIDEO_ENGINE_MOCK=false
IMAGE_ENGINE_MOCK=true     # 火山图像生成 Phase 1 占位；保持 mock 直到接 SeedDream
STITCH_RUNTIME=local
ENABLE_VIDEO_STITCHING=true

CHINA_COMPLIANCE_MODE=true
CONTENT_REVIEW_ENABLED=false
SMS_LOGIN_ENABLED=false
PAYMENT_ENABLED=false

NEXT_PUBLIC_DEFAULT_LOCALE=zh-CN

SEED_ADMIN_EMAIL=admin@aivora.cn
SEED_ADMIN_PASSWORD=ChangeMe-1234   # 首次部署后立即改密
```

**重要**：
- **绝不**把 `.env.production.cn` 提交到 git。`.gitignore` 已经 ignore `.env*.local`，但中国大陆 production 请用单独 `.env.production.cn` 并放在 ECS 服务器的 `/opt/aivora/.env.production.cn`，权限 `600`。
- 任何业务代码都不应该写死中国 endpoint；如果发现请上报。

## 2. 数据库准备（火山 RDS PostgreSQL）

### 2.1 创建实例

1. 火山控制台 → 数据库 RDS PostgreSQL → 创建实例
2. 引擎版本：PostgreSQL 14+ 或 15+（推荐 15）
3. 实例规格：1C2G 起步即可（demo 用），后续按负载升
4. 网络：必须与 ECS 同 VPC（内网连接不出公网，更快更安全）
5. 高可用：demo 阶段可单可用区；生产推荐多可用区
6. 备份：默认开启，保留 7-30 天

### 2.2 白名单 / 安全组

- RDS 默认拒绝所有 IP；在「白名单」里加入 ECS 的内网 IP（或整个 VPC 网段）
- ECS 安全组：默认出站规则放行 RDS 端口 5432
- **不要**把 RDS 暴露到公网（即不要加 0.0.0.0/0）

### 2.3 创建数据库 + 账号

```sql
CREATE DATABASE aivora;
CREATE USER aivora WITH ENCRYPTED PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE aivora TO aivora;
ALTER DATABASE aivora OWNER TO aivora;
```

### 2.4 SSL 连接

火山 RDS 默认支持 SSL。在 `DATABASE_URL` 末尾加 `?sslmode=require`：

```
postgresql://aivora:PASSWORD@pgm-xxxx.rds.volces.com:5432/aivora?sslmode=require
```

如果客户端要验证证书，下载火山 CA 证书：
- 控制台 RDS → 实例 → SSL → 下载根证书
- 上传到 ECS `/opt/aivora/certs/volc-rds-ca.crt`
- `DATABASE_URL` 改为 `?sslmode=verify-full&sslrootcert=/opt/aivora/certs/volc-rds-ca.crt`

### 2.5 Prisma 迁移

```bash
# 在 ECS 上（容器外或容器内皆可）
docker compose --env-file .env.production.cn run --rm web \
  npx prisma migrate deploy

# 可选：首次种子
docker compose --env-file .env.production.cn run --rm web \
  npx tsx prisma/seed.ts
```

**确认事项**：
- ✅ 项目使用标准 Prisma + `provider = "postgresql"`（`prisma/schema.prisma`），**未**依赖 Neon serverless driver。
- ✅ `src/lib/db.ts` 用标准 `PrismaClient`（global 缓存仅 dev），生产环境每个进程 new 一个。
- ✅ 不依赖 Prisma Accelerate / Pulse / Neon-specific connection pooling。
- ⚠️ Next.js production 进程默认连接池 = `num_physical_cpus * 2 + 1`；ECS 1C2G 上跑两个 web 实例可能占满 RDS 默认 100 连接，建议小机型限制 `?connection_limit=10`。

### 2.6 数据迁移（已有海外数据时）

只迁移 schema：
```bash
# 在海外环境
pg_dump --schema-only --no-owner --no-acl $NEON_DATABASE_URL > schema.sql
# 在国内环境
psql $DATABASE_URL < schema.sql
```

迁移 schema + 部分数据：
```bash
# 海外 dump
pg_dump --no-owner --no-acl --exclude-table-data='AnalyticsSnapshot' $NEON_DATABASE_URL > full.sql
# 国内 restore
psql $DATABASE_URL < full.sql
```

**仅 demo 数据（不带用户真实数据）**：使用 `prisma db seed` 重新种子，比迁移更安全。

## 3. 对象存储（火山 TOS）

> **Phase 2A 状态**：`volcengine-tos-provider.ts` 已基于 `@volcengine/tos-sdk` 2.9.x 真实接入，
> 业务侧 `uploadBuffer / uploadFile / getSignedDownloadUrl / getSignedUploadUrl / getPublicUrl /
> deleteObject / copyObject` 全部可用。海外 Vercel Blob 路径完全不受影响。

### 3.1 创建 Bucket

控制台 TOS → 创建桶（推荐建在 ECS / RDS 同 region）：

| Bucket 名 | 用途 | 默认 ACL | 建议存储类型 | CDN |
|---|---|---|---|---|
| `aivora-cn-uploads` | 用户上传素材 | **私有** | 标准 | 无 |
| `aivora-cn-renders` | AI 生成 / 拼接视频成品 | **私有** | 标准 | 可挂火山 CDN |

**为什么默认私有**：
1. 合规（用户上传的素材可能含品牌物料、企业内部资料），不应公网可枚举。
2. 即便 demo 阶段不挂 CDN，业务代码会通过 `getSignedDownloadUrl()` 临时签 600s 链接给前端，
   过期后链接自动失效；不会出现"复制链接外传"的风险。
3. `aivora-cn-renders` 后续接 CDN 时，CDN 回源签名 + bucket 私有是火山推荐的安全姿势。

> 例外：当前 `/api/upload/blob` 路由会把素材上传时打 `access: public` 标记，
> 是为了让 Seedance / 方舟视觉模型拉取参考图。生产建议在 `aivora-cn-uploads` 上
> 配 Bucket Policy 仅放行火山 Ark 服务来源 IP，或改用预签名 GET URL（需要后续小改造）。

CORS 配置（uploads bucket，若需要前端直传 signed URL）：
```json
{
  "allowedOrigins": ["https://demo.aivora.cn"],
  "allowedMethods": ["PUT", "POST", "GET", "HEAD"],
  "allowedHeaders": ["*"],
  "exposeHeaders": ["ETag"],
  "maxAgeSeconds": 3600
}
```

### 3.2 子账号 & 权限

火山 IAM → 创建子账号 `aivora-cn-app`：
- 权限策略：自定义，仅授权 `aivora-cn-uploads` / `aivora-cn-renders` 两个 bucket 的
  `tos:GetObject` / `tos:PutObject` / `tos:DeleteObject` / `tos:GetObjectAcl` /
  `tos:ListBucket` / `tos:HeadBucket`（最后一个 `/api/health?storage=ping` 检查用）。
- 不要给该子账号任何 RDS / ECS / Ark 之外的权限。
- 创建 Access Key → 填入 `VOLCENGINE_ACCESS_KEY_ID` / `VOLCENGINE_SECRET_ACCESS_KEY`。
- 启用 AK 轮换计划，**不要**把 AK/SK 写进 `docker-compose.yml`、git 或截图里。

### 3.3 必填环境变量速查

```bash
# Provider 选择
STORAGE_PROVIDER=volcengine_tos
REGION=cn

# 凭证（来自上一步子账号）
VOLCENGINE_ACCESS_KEY_ID=AKxxxxxxxxxxxxxxxxxx
VOLCENGINE_SECRET_ACCESS_KEY=...

# 区域与 endpoint
VOLCENGINE_TOS_ENDPOINT=tos-cn-beijing.volces.com     # 或 tos-cn-shanghai.volces.com
VOLCENGINE_TOS_REGION=cn-beijing

# 物理 bucket（业务代码只关心 uploads/renders 逻辑名，物理名走 env，不写死）
VOLCENGINE_TOS_BUCKET_UPLOADS=aivora-cn-uploads
VOLCENGINE_TOS_BUCKET_RENDERS=aivora-cn-renders

# 公开访问 URL（二选一；可不填走 endpoint 直链）
CDN_BASE_URL=https://cdn.aivora.cn                    # 推荐，挂火山 CDN 后填
VOLCENGINE_TOS_PUBLIC_BASE_URL=https://aivora-cn-renders.tos-cn-beijing.volces.com   # 退而求其次
```

### 3.4 CDN（公开测试前必接）

火山 CDN：
- 加速域名：`cdn.aivora.cn`（已 ICP 备案）
- 回源域名：`aivora-cn-renders.tos-cn-beijing.volces.com`
- 回源协议：HTTPS
- 缓存规则：`.mp4 / .png / .jpg / .webp` → 7 天；`.json` → 1h
- 鉴权方式：Bucket 私有 → CDN 配 **回源鉴权 + 鉴权 KEY** 走 TOS bucket policy（推荐 A/B/C 任一签名）
- 配置 `CDN_BASE_URL=https://cdn.aivora.cn` 后，业务代码 `getPublicUrl()` 会自动用 CDN URL，
  历史已存的 endpoint 直链 URL 不会被改写（DB 中存的是上传时的 URL）。

> **优先级**：`CDN_BASE_URL` > `VOLCENGINE_TOS_PUBLIC_BASE_URL` > `https://bucket.endpoint`。
> 详见 `src/lib/storage/providers/volcengine-tos-provider.ts:getPublicUrl()`。

### 3.5 ECS 验证 TOS 连通性

部署完成后第一时间跑：

```bash
# A) 容器外直接调健康检查（最快验证 AK/SK/endpoint/bucket 全通）
curl -s "https://demo.aivora.cn/api/health?storage=ping" | jq '.storage, .storageProvider'
# 期望: "reachable"  "volcengine_tos"

# B) 容器内手工 ping（看不通时排错用）
docker compose --env-file .env.production.cn run --rm web \
  node --import tsx -e "
    const { VolcengineTosStorageProvider } = await import('@/lib/storage/providers/volcengine-tos-provider');
    const s = new VolcengineTosStorageProvider();
    console.log(await s.pingBucket('renders'));
    console.log(await s.pingBucket('uploads'));
  "

# C) 跑一次真实 putObject + deleteObject smoke test（会消耗几个字节 TOS 容量）
docker compose --env-file .env.production.cn run --rm web \
  node --import tsx -e "
    const { getStorageProvider } = await import('@/lib/storage');
    const s = getStorageProvider();
    const r = await s.uploadBuffer('renders', Buffer.from('smoke'), {
      key: 'smoke/' + Date.now() + '.txt',
      contentType: 'text/plain',
      overwrite: true,
    });
    console.log('uploaded:', r);
    await s.deleteObject('renders', r.key);
    console.log('deleted ok');
  "
```

### 3.6 首次联调 Checklist

按这个顺序排查更高效（每一步都要绿了才进下一步）：

- [ ] 1. `.env.production.cn` 里 `STORAGE_PROVIDER=volcengine_tos`、`VOLCENGINE_*` 五件套全填。
- [ ] 2. AK/SK 在火山 IAM 控制台是「启用」状态。
- [ ] 3. 子账号策略包含两个 bucket 的读写 + `HeadBucket`。
- [ ] 4. ECS 安全组出站允许 443 → `*.volces.com`。
- [ ] 5. `curl /api/health?storage=ping` 返回 `storage: "reachable"`。
- [ ] 6. 手动上传一个图片到 `/api/upload/blob`，前端能预览（用浏览器 DevTools 看响应 url）。
- [ ] 7. Seedance 生成一个 3 秒视频，db 里 `VideoJob.outputVideoUrl` 是 TOS / CDN 域名，不再是 `*.public.blob.vercel-storage.com`。
- [ ] 8. 把 8s 视频拼接成 30s 成片，`/api/v/{id}` 能播。
- [ ] 9. （如果接了 CDN）刷新 `cdn.aivora.cn` 域名 → DevTools Network → Response Header 包含 `X-Cache: HIT`。

### 3.7 常见错误对照表

| 现象 / 报错 | 根因 | 解决 |
|---|---|---|
| `[volcengine-tos] uploadBuffer 调用失败：缺少必要环境变量` | env 五件套有缺失 | 对照 3.3 表，特别注意 `VOLCENGINE_TOS_BUCKET_UPLOADS` 别拼错 |
| `[volcengine-tos] uploadBuffer 失败 status=403` | AK/SK 权限不足；或子账号没绑两个 bucket | IAM 控制台核对策略；用 root AK 临时验证 |
| `[volcengine-tos] uploadBuffer 失败 status=404` | bucket 不存在；或 region/endpoint 不匹配 | 控制台确认 bucket 存在 + 跟 endpoint 同 region |
| `... failed status=400 ... InvalidEndpoint` | endpoint 拼错（多了/少了 `https://`） | 只写主机名，例如 `tos-cn-beijing.volces.com`，**不要带** `https://` |
| `... status=409 ObjectExists` | 写入同 key 但 `overwrite=false`（默认） | 业务侧设 `overwrite: true`（拼接 / 渲染服务已默认开） |
| 上传成功但前端无法播放视频 | bucket 私有且没接 CDN，浏览器直接拉 endpoint 域名拿 403 | 接 CDN 或临时改 bucket 公开读 |
| `signed URL 过期` 错误 | 默认 600s 太短 | 上传素材类用 7 天（604800）；播放视频类应通过 CDN，不用 signed URL |
| CDN 回 404 | CDN 回源域名写错；或 bucket 没开"公网域名访问" | 控制台 CDN → 源站 → 改回源 host；TOS bucket → 域名管理开公网域名 |
| `/api/health?storage=ping` 返回 `storage: "failed"` 且 error 中含 `status=403` | AK/SK 没有 `HeadBucket` 权限 | IAM 策略追加 `tos:HeadBucket` |
| `/api/health?storage=ping` 长时间挂起 | ECS 出网到 TOS 不通；或 endpoint 域名 DNS 解析慢 | ECS 上 `nslookup tos-cn-beijing.volces.com`；检查安全组 |

## 4. Docker 部署

### 4.1 服务器初始化

```bash
# Ubuntu 22.04 LTS
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl gnupg lsb-release ffmpeg nginx

# Docker 官方仓库（用阿里云镜像加速国内下载）
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 验证
docker --version
docker compose version
```

### 4.2 拉代码

```bash
sudo mkdir -p /opt/aivora && sudo chown $USER:$USER /opt/aivora
cd /opt/aivora
git clone https://github.com/your-org/aivora.git .
git checkout main

# 写入 .env.production.cn（参考 .env.china.example）
cp .env.china.example .env.production.cn
vim .env.production.cn   # 填入真实密钥
chmod 600 .env.production.cn
```

### 4.3 构建 & 启动

```bash
# 构建镜像（Dockerfile 在仓库根目录）
docker compose --env-file .env.production.cn build

# 启动（detached）
docker compose --env-file .env.production.cn up -d

# 查看日志
docker compose logs -f web
docker compose logs -f worker

# 重启
docker compose --env-file .env.production.cn restart web
```

### 4.4 数据库迁移

```bash
docker compose --env-file .env.production.cn run --rm web \
  npx prisma migrate deploy

# 首次种子
docker compose --env-file .env.production.cn run --rm web \
  npx tsx prisma/seed.ts
```

### 4.5 健康检查

```bash
curl -s http://localhost:3000/api/health | jq
# 期望返回 { ok: true, region: "cn", aiProvider: "volcengine", ... }
```

## 5. Nginx 反向代理 + HTTPS

`/etc/nginx/sites-available/aivora.conf`：

```nginx
upstream aivora_web {
    server 127.0.0.1:3000 max_fails=2 fail_timeout=5s;
    keepalive 32;
}

server {
    listen 80;
    server_name demo.aivora.cn;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name demo.aivora.cn;

    ssl_certificate     /etc/letsencrypt/live/demo.aivora.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/demo.aivora.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 120m;  # 上传素材最大 100m + 余量

    location / {
        proxy_pass         http://aivora_web;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 300;
    }

    location /api/health {
        proxy_pass http://aivora_web;
        access_log off;
    }
}
```

启用 + Let's Encrypt 证书：
```bash
sudo ln -s /etc/nginx/sites-available/aivora.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d demo.aivora.cn
```

## 6. 域名与备案

- ICP 备案：阿里云 / 火山 / 腾讯云 备案系统均可（推荐火山因 ECS 在火山）
- 备案完成前**不能**对公网开放；可在 hosts 文件本地解析做内部测试
- 公安联网备案（接入审核）：备案通过 30 天内必须办

## 7. Cron / Worker（视频任务调度）

`docker-compose.yml` 里 `worker` service 每分钟跑一次 reconciliation。
也可以用 systemd-timer 调外网 endpoint（备份方案）：

`/etc/systemd/system/aivora-poll.service`：
```ini
[Unit]
Description=Aivora poll videos

[Service]
Type=oneshot
EnvironmentFile=/opt/aivora/.env.production.cn
ExecStart=/usr/bin/curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/cron/poll-videos
```

`/etc/systemd/system/aivora-poll.timer`：
```ini
[Unit]
Description=Aivora poll videos every 2 min

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aivora-poll.timer
```

## 8. 常见故障排查

| 症状 | 可能原因 | 解决 |
|---|---|---|
| `prisma migrate deploy` 报 `password authentication failed` | RDS 白名单未加 ECS 内网 IP | 控制台白名单加 ECS 内网网段 |
| `/api/health` 返回 `database: failed` | DATABASE_URL 错 / SSL 配置不对 | 检查 sslmode；ping pgm-xxxx host |
| `/api/health?storage=ping` 返回 `storage: "failed"` | TOS env 缺失 / AK 权限不足 / 网络不通 | 参考第 3.7 节常见错误对照表 |
| 视频生成报 `[volcengine-tos] uploadBuffer 调用失败：缺少必要环境变量` | VOLCENGINE_TOS_* 未全配 | 对照 3.3 表填齐 |
| 视频生成报 `ARK_API_KEY 未配置` | 没配方舟 key 又关了 mock | 配置 ARK_API_KEY 或 VIDEO_ENGINE_MOCK=true |
| 容器启动 OOM | 默认 4G ECS 跑 web + worker + nginx 紧张 | 限制 Node `--max-old-space-size=1024`；或升 8G |
| Nginx 502 | 容器没起 / 端口冲突 | `docker compose ps` 看 web 是否 Up |
| 拼接视频 `ffmpeg: command not found` | 容器内未装 ffmpeg | 已在 Dockerfile 装；如自定义镜像确认 |
| 上传超时 | Nginx `client_max_body_size` 不够 | 已设 120m，按需调大 |

## 9. 回滚

- 代码回滚：`git checkout <prev-commit> && docker compose build && docker compose up -d`
- 数据库回滚：避免，schema migration 写**只增不减**的 migration；如果必须，先用 RDS 控制台 PITR（point-in-time recovery）
- 灰度：可以在 Nginx 上做 weighted upstream 切流量到新旧两个 docker compose

## 10. 监控建议

- ECS / RDS / TOS 默认接火山观测云监控
- 应用层接 OpenTelemetry → 火山 APM
- Critical 报警：
  - `/api/health` 5 分钟连续失败
  - VideoJob FAILED 突增（> N/小时）
  - RDS 连接数 > 80%
  - TOS 存储 > bucket 配额 80%

---

附：海外（Vercel）部署仍然按 `docs/DEPLOYMENT.md`；两份文档独立维护，互不替代。
