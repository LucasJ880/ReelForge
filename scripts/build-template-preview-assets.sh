#!/usr/bin/env bash
# 模板样片装配:真机成片(720x1280 15s) → 悬停预览 mp4(960x540/30fps/3s/~250k)
# + poster jpg(640x360),规格对齐既有 public/template-previews 资产。
#
# 用法:
#   scripts/build-template-preview-assets.sh qa       # 逐条出 15 帧接触表供人工检查
#   scripts/build-template-preview-assets.sh build    # 全部装配进 public/template-previews/
#   scripts/build-template-preview-assets.sh build commerce-food-sizzle   # 只装配指定 slug
#
# 每个 slug 的预览起始秒数默认 6(中段 proof 拍),可在 OFFSETS 里按 QA 结论覆写。
set -euo pipefail

RUN_KEY="${REAL_SAMPLES_RUN_KEY:-template-samples-20260803-v1}"
VIDEO_DIR="tmp/real-template-samples/${RUN_KEY}-videos"
QA_DIR="tmp/real-template-samples/${RUN_KEY}-qa"
OUT_DIR="public/template-previews"

# slug=起始秒;QA 后针对钩子更强的模板覆写(默认 6)。
declare -A OFFSETS=()

# 人物主导的模板:9:16 → 16:9 用上部裁切(6% 顶边),否则中央带会砍头。
declare -A TOPCROP=(
  [commerce-talking-head-review]=1
  [commerce-podcast-authority]=1
  [commerce-founder-story]=1
  [commerce-street-interview]=1
  [commerce-creator-reaction]=1
  [commerce-fashion-lookbook]=1
  [commerce-morning-routine]=1
  [commerce-beauty-texture]=1
)

mode="${1:-qa}"
only="${2:-}"

mkdir -p "$QA_DIR"

shopt -s nullglob
for src in "$VIDEO_DIR"/*.mp4; do
  slug="$(basename "$src" .mp4)"
  if [[ -n "$only" && "$slug" != "$only" ]]; then continue; fi
  if [[ "$mode" == "qa" ]]; then
    sheet="$QA_DIR/${slug}-sheet.jpg"
    ffmpeg -v error -y -i "$src" \
      -vf "fps=1,scale=200:-1,tile=15x1" -frames:v 1 "$sheet"
    echo "sheet: $sheet"
  else
    off="${OFFSETS[$slug]:-6}"
    if [[ -n "${TOPCROP[$slug]:-}" ]]; then
      cropf="crop=iw:iw*9/16:0:ih*0.06"
    else
      cropf="crop=iw:iw*9/16"
    fi
    ffmpeg -v error -y -ss "$off" -i "$src" -t 3 \
      -vf "${cropf},scale=960:540,fps=30" \
      -an -c:v libx264 -b:v 250k -pix_fmt yuv420p -movflags +faststart \
      "$OUT_DIR/${slug}.mp4"
    ffmpeg -v error -y -ss "$(python3 -c "print(${off}+0.5)")" -i "$src" -frames:v 1 \
      -vf "${cropf},scale=640:360" -q:v 3 "$OUT_DIR/${slug}.jpg"
    echo "built: $OUT_DIR/${slug}.mp4 + .jpg (offset ${off}s topcrop=${TOPCROP[$slug]:-0})"
  fi
done
