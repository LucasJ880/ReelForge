#!/usr/bin/env bash
#
# 生成 /showcase 投资人 demo 的「纯静态」站点，用于上传到对象存储 + CDN
# （阿里云香港 OSS + CDN，免 ICP 备案，保证大陆可访问）。
#
# 原理（快照式）：整套 App 含 API 路由 + NextAuth，无法整体 output:'export'；
# 这里复用真实生产构建，把 /showcase 的 SSR HTML + _next 静态资源 + 引用到的
# 图片/视频 打包成自包含的静态目录，样式/字体与线上 100% 一致。
#
# 表单：构建时注入 NEXT_PUBLIC_STATIC_DEMO=true，PetWaitlistForm 走 mock 提交
# （保留 UI、假成功），不连任何后端；线上 Vercel 不设该变量，真实接口不受影响。
#
# 产物目录：showcase-static/  （把它的「内容」整体上传到 OSS 桶根目录）
#
# 用法：bash scripts/build-showcase-static.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/showcase-static"
PORT="${SHOWCASE_STATIC_PORT:-4123}"

# 需要随静态站一起打包的 /generated 视频（按文件名，不含目录）。
GENERATED_FILES=(
  "aivora-pet-content-kit-walkthrough-60s-16x9.mp4"
  "pet-evidence-headtilt.mp4"
  "pet-evidence-highlight.mp4"
  "pet-evidence-mat.mp4"
  "pet-evidence-raw.mp4"
)

echo "==> [1/5] 生产构建（NEXT_PUBLIC_STATIC_DEMO=true）"
NEXT_PUBLIC_STATIC_DEMO=true npm run build

echo "==> [2/5] 启动生产服务器，抓取 /showcase 的 SSR HTML"
npx next start -p "$PORT" > /tmp/showcase-static-server.log 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT
# 等待服务器就绪
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/showcase" 2>/dev/null; then break; fi
  sleep 1
done

rm -rf "$OUT"
mkdir -p "$OUT/_next" "$OUT/demo" "$OUT/generated"
curl -fsS "http://127.0.0.1:$PORT/showcase" -o "$OUT/index.html"

echo "==> [3/5] 拷贝 _next 静态资源 + favicon"
cp -R "$ROOT/.next/static" "$OUT/_next/static"
cp "$ROOT/src/app/favicon.ico" "$OUT/favicon.ico"

echo "==> [4/5] 拷贝图片与视频资源"
cp -R "$ROOT/public/demo/pet" "$OUT/demo/pet"
for f in "${GENERATED_FILES[@]}"; do
  cp "$ROOT/public/generated/$f" "$OUT/generated/"
done

echo "==> [5/5] 完成"
kill "$SRV" 2>/dev/null || true
trap - EXIT

echo
echo "静态站已生成：$OUT （$(du -sh "$OUT" | cut -f1)）"
echo "把该目录【内容】整体上传到阿里云香港 OSS 桶根目录即可（index.html 在最外层）。"
echo "本地预览：cd showcase-static && python3 -m http.server 4500 然后访问 http://127.0.0.1:4500/"
