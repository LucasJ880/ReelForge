"""
ReelForge — 天桥上的伞 — 6 场景 AI 视频生产 (v2: I2V + 角色一致性)
================================================================
支持两种模式:
  - I2V (Image-to-Video): 将参考图作为首帧，模型从该帧开始生成动画
  - T2V (Text-to-Video):  纯文字 prompt，适用于背影/远景/氛围镜头

参考图放置位置:
    storage/love_story/refs/female.jpg   — 女主参考照片
    storage/love_story/refs/male.jpg     — 男主参考照片

用法:
    python scripts/produce_love_story.py               # 完整生成 + 拼接
    python scripts/produce_love_story.py --skip-gen     # 跳过生成，只拼接
    python scripts/produce_love_story.py --test S3      # 只测试单个场景
"""

import httpx
import asyncio
import json
import os
import sys
import subprocess
import struct
import math
import base64
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

ARK_API_KEY = os.environ.get("ARK_API_KEY", "")
ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
MODEL = os.environ.get("ARK_VIDEO_MODEL", "doubao-seedance-1-5-pro-251215")
RESOLUTION = os.environ.get("ARK_VIDEO_RESOLUTION", "720p")

PROJECT_ROOT = Path(__file__).parent.parent
OUTPUT_DIR = PROJECT_ROOT / "storage" / "love_story"
REFS_DIR = OUTPUT_DIR / "refs"

FFMPEG_EXE = None
try:
    import imageio_ffmpeg
    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    pass

# ── Reference Image Paths ────────────────────────────────

FEMALE_REF = REFS_DIR / "female.jpg"
MALE_REF = REFS_DIR / "male.jpg"

FEMALE_ALTS = [REFS_DIR / "female.png", REFS_DIR / "female.jpeg", REFS_DIR / "female.webp"]
MALE_ALTS = [REFS_DIR / "male.png", REFS_DIR / "male.jpeg", REFS_DIR / "male.webp"]


def _find_ref(primary: Path, alts: list[Path]) -> Path | None:
    if primary.exists():
        return primary
    for p in alts:
        if p.exists():
            return p
    return None


def _image_to_base64_url(path: Path) -> str:
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode()
    ext = path.suffix.lower().lstrip(".")
    if ext == "jpg":
        ext = "jpeg"
    return f"data:image/{ext};base64,{b64}"


# ── Scene Definitions (v2: I2V-aware) ────────────────────
#
# 每个 scene 明确定义:
#   mode:       "i2v" (图生视频) 或 "t2v" (文生视频)
#   ref:        "female" / "male" / None
#   characters: 谁出镜，怎样出镜
#   prompt:     I2V 模式下侧重动作/运动/变化，不重复描述外貌
#              T2V 模式下包含完整场景+人物描述

STYLE_T2V = (
    "Cinematic, 9:16 vertical, 35mm film lens, natural color grading, "
    "Chinese urban setting, clean composition, no text overlay, no watermark, "
    "no vulgarity, no gore, no sexualized content. "
    "Emotionally restrained, quiet storytelling. "
)

STYLE_I2V = (
    "Cinematic, 9:16 vertical, 35mm film lens, natural color grading, "
    "smooth gentle motion, emotionally restrained, quiet storytelling. "
    "No text overlay, no watermark, no vulgarity, no gore, no sexualized content. "
)

SCENES = [
    {
        "id": "S1",
        "name": "天桥逆光剪影",
        "duration": 5,
        "mode": "t2v",
        "ref": None,
        "characters": "女主背影剪影，不需要面部，降低一致性压力",
        "prompt": STYLE_T2V + (
            "A young Chinese woman with long black hair seen from behind, "
            "walking alone on a city pedestrian overpass at golden hour. "
            "Low angle shot looking up at her silhouette against golden sunset sky. "
            "Blurred commuters passing by. Her hair blowing gently in the breeze. "
            "Camera slowly tilts upward. Warm golden backlight, cool blue shadows. "
            "Chinese city skyline background. Shallow depth of field."
        ),
    },
    {
        "id": "S2",
        "name": "擦肩而过",
        "duration": 5,
        "mode": "t2v",
        "ref": None,
        "characters": "男女侧面擦肩，远景中景，不需要清晰面部",
        "prompt": STYLE_T2V + (
            "City pedestrian overpass at blue hour dusk. "
            "Medium-wide shot: a young woman with long black hair walks from left, "
            "a young man in white t-shirt walks from right. "
            "They pass each other closely. The man slightly turns his head to glance at her. "
            "Brief moment of eye contact then they continue walking apart. "
            "Soft blue twilight sky, urban lights glowing in background. "
            "Slightly slow motion as they cross paths. Cool blue tones, warm accent lights."
        ),
    },
    {
        "id": "S3",
        "name": "雨中等待",
        "duration": 8,
        "mode": "i2v",
        "ref": "female",
        "characters": "女主侧面特写，面部可见，用参考图确保一致性",
        "prompt": STYLE_I2V + (
            "The woman stands still under a stairway entrance sheltering from heavy rain. "
            "She holds her bag close to her chest. She looks out at the falling rain. "
            "Heavy rain cascading in front of her creating a blurred rain curtain. "
            "Warm orange street lamp light illuminates her face from the side. "
            "Cold blue rain outside contrasts with warm light on her skin. "
            "Night urban setting. She blinks slowly, looking slightly downward with contemplation. "
            "Raindrops splash on the ground. Shallow depth of field."
        ),
    },
    {
        "id": "S4",
        "name": "留伞",
        "duration": 5,
        "mode": "t2v",
        "ref": None,
        "characters": "男主背影为主，放伞动作特写，不需要正脸",
        "prompt": STYLE_T2V + (
            "Rainy night under a city overpass stairway. "
            "Close-up of a hand gently placing a folded transparent umbrella on the ground "
            "next to a pair of feet. Then camera pulls back: "
            "a young man in white t-shirt turns away, walks into the rain with his back "
            "to camera. His silhouette gradually disappears into blurred city lights "
            "and rain streaks. Warm street lamp glow. Visible raindrops. "
            "Deep emotional restraint. Silent act of tenderness."
        ),
    },
    {
        "id": "S5",
        "name": "回头已不见",
        "duration": 5,
        "mode": "i2v",
        "ref": "female",
        "characters": "女主正面/侧面，惊讶回头的表情，用参考图",
        "prompt": STYLE_I2V + (
            "The woman bends down to pick up the umbrella from the ground. "
            "She looks at it with surprise, then quickly turns around searching for someone. "
            "Her eyes widen with hope then shift to gentle disappointment. "
            "Behind her the rainy overpass stretches into the distance with blurred "
            "orange bokeh lights. A faint silhouette of a man walking away in the far rain, "
            "barely visible. Night rain. Rack focus from her face to the distant figure. "
            "Longing, regret, missed connection."
        ),
    },
    {
        "id": "S6",
        "name": "两把伞的重逢",
        "duration": 8,
        "mode": "i2v",
        "ref": "female",
        "characters": "女主正面微笑，重逢核心镜头，用参考图",
        "prompt": STYLE_I2V + (
            "Days later, golden hour on the same overpass. "
            "The woman stands holding two umbrellas, waiting. Golden warm sunlight from behind. "
            "She looks into the distance expectantly. Then a gentle smile appears on her face "
            "as she sees someone approaching. Camera slowly pushes in. "
            "Warm golden light wraps around her. Sky filled with golden clouds. "
            "Her smile grows softer with relief and tenderness. "
            "Hope, quiet reunion, emotional resolution. 35mm film look, soft lens flare."
        ),
    },
]


# ── Ark API ──────────────────────────────────────────────

def _headers():
    return {
        "Authorization": f"Bearer {ARK_API_KEY}",
        "Content-Type": "application/json",
    }


async def submit_task(
    client: httpx.AsyncClient, scene: dict, ref_images: dict[str, Path]
) -> tuple[str, str, str]:
    """
    Submit a generation task. Returns (task_id, status, mode_used).
    For I2V scenes with a valid ref image, includes image_url in content array.
    Falls back to T2V if ref image is missing.
    """
    mode = scene["mode"]
    content_items = []

    if mode == "i2v" and scene.get("ref") and scene["ref"] in ref_images:
        ref_path = ref_images[scene["ref"]]
        img_b64_url = _image_to_base64_url(ref_path)
        content_items.append({
            "type": "image_url",
            "image_url": {"url": img_b64_url},
        })
        actual_mode = "i2v"
    else:
        if mode == "i2v":
            print(f"\n    [WARN] {scene['id']} needs {scene.get('ref')} ref but not found, fallback T2V")
        actual_mode = "t2v"

    content_items.append({"type": "text", "text": scene["prompt"][:2000]})

    payload = {
        "model": MODEL,
        "content": content_items,
        "ratio": "9:16",
        "duration": scene["duration"],
        "resolution": RESOLUTION,
    }

    resp = await client.post(
        f"{ARK_BASE_URL}/contents/generations/tasks",
        json=payload,
        headers=_headers(),
        timeout=90,
    )
    resp.raise_for_status()
    body = resp.json()
    return body.get("id", ""), body.get("status", "queued"), actual_mode


async def poll_until_done(
    client: httpx.AsyncClient, task_id: str, max_seconds: int = 600
) -> tuple[str, str, dict]:
    start = asyncio.get_event_loop().time()
    polls = 0
    while (asyncio.get_event_loop().time() - start) < max_seconds:
        resp = await client.get(
            f"{ARK_BASE_URL}/contents/generations/tasks/{task_id}",
            headers=_headers(),
            timeout=20,
        )
        resp.raise_for_status()
        body = resp.json()
        status = body.get("status", "running")

        if status == "succeeded":
            url = (body.get("content") or {}).get("video_url", "")
            return "ok", url, body
        if status in ("failed", "expired"):
            err = (body.get("error") or {}).get("message", status)
            return "fail", err, body

        polls += 1
        if polls % 4 == 0:
            elapsed = int(asyncio.get_event_loop().time() - start)
            print(f" ({elapsed}s)", end="", flush=True)

        await asyncio.sleep(12)
    return "timeout", "exceeded max wait", {}


async def download(client: httpx.AsyncClient, url: str, path: Path) -> int:
    resp = await client.get(url, timeout=180, follow_redirects=True)
    resp.raise_for_status()
    path.write_bytes(resp.content)
    return len(resp.content)


# ── BGM Generation ───────────────────────────────────────

def _generate_simple_bgm(path: Path, duration_s: float, sample_rate: int = 44100):
    n_samples = int(duration_s * sample_rate)
    chords = [
        [261.63, 329.63, 392.00],
        [220.00, 277.18, 329.63],
        [246.94, 311.13, 369.99],
        [196.00, 246.94, 293.66],
        [261.63, 329.63, 392.00],
        [220.00, 261.63, 329.63],
        [246.94, 293.66, 369.99],
        [196.00, 246.94, 293.66],
    ]
    chord_len = n_samples // len(chords)
    samples = []

    for freqs in chords:
        for i in range(chord_len):
            t = i / sample_rate
            env_a = min(1.0, i / (sample_rate * 0.3))
            env_r = min(1.0, (chord_len - i) / (sample_rate * 0.5))
            env = env_a * env_r * 0.15
            val = sum(math.sin(2 * math.pi * f * t) + 0.3 * math.sin(4 * math.pi * f * t) for f in freqs)
            val = val / (len(freqs) * 1.3) * env
            samples.append(max(-32767, min(32767, int(val * 32767))))

    remaining = n_samples - len(samples)
    for i in range(max(0, remaining)):
        env = min(1.0, (remaining - i) / (sample_rate * 1.0)) * 0.08
        val = math.sin(2 * math.pi * 261.63 * i / sample_rate) * env
        samples.append(max(-32767, min(32767, int(val * 32767))))

    data = b"".join(struct.pack("<h", s) for s in samples)
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + len(data)))
        f.write(b"WAVEfmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", len(data)))
        f.write(data)
    print(f"  BGM generated: {path.name} ({duration_s:.1f}s)")


# ── Video Concatenation + BGM ────────────────────────────

def concat_with_bgm(video_paths: list[Path], bgm_path: Path, output_path: Path):
    if not FFMPEG_EXE:
        print("  [WARN] ffmpeg not available, skip concat")
        return False

    concat_list = OUTPUT_DIR / "concat_list.txt"
    with open(concat_list, "w", encoding="utf-8") as f:
        for vp in video_paths:
            escaped = str(vp).replace("\\", "/").replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")

    cmd = [
        FFMPEG_EXE, "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-i", str(bgm_path),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
        "-shortest", str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=120, encoding="utf-8", errors="replace")
    if result.returncode == 0:
        size_mb = output_path.stat().st_size / 1_000_000
        print(f"  [OK] final: {output_path.name} ({size_mb:.1f}MB)")
        return True
    else:
        print(f"  [FAIL] ffmpeg: {result.stderr[-300:]}")
        return False


# ── Main ─────────────────────────────────────────────────

async def generate_scenes(scene_filter: str | None = None):
    if not ARK_API_KEY:
        print("ERROR: ARK_API_KEY not set in .env")
        return []

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REFS_DIR.mkdir(parents=True, exist_ok=True)

    # Locate reference images
    ref_images: dict[str, Path] = {}
    female_path = _find_ref(FEMALE_REF, FEMALE_ALTS)
    male_path = _find_ref(MALE_REF, MALE_ALTS)

    if female_path:
        ref_images["female"] = female_path
        size_kb = female_path.stat().st_size / 1024
        print(f"  [REF] female: {female_path.name} ({size_kb:.0f}KB)")
    else:
        print(f"  [WARN] female ref NOT FOUND in {REFS_DIR}")
        print(f"         Please save female photo as: {REFS_DIR}/female.jpg")

    if male_path:
        ref_images["male"] = male_path
        size_kb = male_path.stat().st_size / 1024
        print(f"  [REF] male: {male_path.name} ({size_kb:.0f}KB)")
    else:
        print(f"  [WARN] male ref NOT FOUND in {REFS_DIR}")
        print(f"         Please save male photo as: {REFS_DIR}/male.jpg")

    scenes_to_run = SCENES
    if scene_filter:
        scenes_to_run = [s for s in SCENES if s["id"] == scene_filter]
        if not scenes_to_run:
            print(f"ERROR: scene {scene_filter} not found")
            return []

    i2v_count = sum(1 for s in scenes_to_run if s["mode"] == "i2v" and s.get("ref") in ref_images)
    t2v_count = len(scenes_to_run) - i2v_count

    print(f"\n{'='*60}")
    print(f"  Love Story v2 - I2V + Character Consistency")
    print(f"  Scenes: {len(scenes_to_run)} (I2V: {i2v_count}, T2V: {t2v_count})")
    print(f"  Model: {MODEL} | Resolution: {RESOLUTION}")
    print(f"  Refs: {list(ref_images.keys()) or 'NONE'}")
    print(f"{'='*60}")

    results = []

    async with httpx.AsyncClient() as client:
        print("\n[Phase 1] Submitting tasks...")
        tasks = []
        for scene in scenes_to_run:
            mode_label = scene["mode"].upper()
            ref_label = f"+{scene['ref']}" if scene.get("ref") else ""
            tag = f"[{scene['id']}] {scene['name']} ({scene['duration']}s {mode_label}{ref_label})"
            print(f"  {tag} ...", end=" ", flush=True)
            try:
                task_id, status, actual_mode = await submit_task(client, scene, ref_images)
                tasks.append({"scene": scene, "task_id": task_id, "mode": actual_mode})
                print(f"[OK] {actual_mode} task={task_id[:16]}...")
                await asyncio.sleep(2)
            except Exception as e:
                print(f"[FAIL] {e}")
                tasks.append({"scene": scene, "task_id": None, "error": str(e)})

        submitted = sum(1 for t in tasks if t.get("task_id"))
        print(f"\n  Submitted: {submitted}/{len(scenes_to_run)}")

        print("\n[Phase 2] Waiting for generation (~60-120s each)...")
        for t in tasks:
            if not t.get("task_id"):
                results.append({
                    "scene_id": t["scene"]["id"],
                    "name": t["scene"]["name"],
                    "mode": t.get("mode", "t2v"),
                    "status": "failed",
                    "error": t.get("error"),
                })
                continue

            scene = t["scene"]
            task_id = t["task_id"]
            print(f"  [{scene['id']}] {scene['name']} polling...", end=" ", flush=True)

            status, data, body = await poll_until_done(client, task_id)

            if status == "ok":
                print(f" [OK] ({body.get('duration', '?')}s)")
                results.append({
                    "scene_id": scene["id"],
                    "name": scene["name"],
                    "mode": t["mode"],
                    "task_id": task_id,
                    "status": "succeeded",
                    "video_url": data,
                    "duration": body.get("duration", scene["duration"]),
                })
            else:
                print(f" [FAIL] {data}")
                results.append({
                    "scene_id": scene["id"],
                    "name": scene["name"],
                    "mode": t["mode"],
                    "task_id": task_id,
                    "status": "failed",
                    "error": data,
                })

        print("\n[Phase 3] Downloading videos...")
        for r in results:
            if r["status"] != "succeeded" or not r.get("video_url"):
                continue
            out_path = OUTPUT_DIR / f"{r['scene_id']}.mp4"
            print(f"  [{r['scene_id']}] {r['name']} ...", end=" ", flush=True)
            try:
                size = await download(client, r["video_url"], out_path)
                mb = size / 1_000_000
                print(f"[OK] {mb:.1f}MB ({r['mode']})")
                r["local_path"] = str(out_path)
                r["file_size_mb"] = round(mb, 1)
            except Exception as e:
                print(f"[FAIL] {e}")

    manifest = {
        "project": "love_story_v2",
        "created_at": datetime.now().isoformat(),
        "model": MODEL,
        "resolution": RESOLUTION,
        "ref_images_used": {k: str(v) for k, v in ref_images.items()},
        "total_scenes": len(scenes_to_run),
        "succeeded": sum(1 for r in results if r["status"] == "succeeded"),
        "scenes": results,
    }
    manifest_path = OUTPUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    ok = manifest["succeeded"]
    print(f"\n  Done: {ok}/{len(scenes_to_run)} scenes succeeded")
    for r in results:
        status_icon = "[OK]" if r["status"] == "succeeded" else "[FAIL]"
        print(f"    {r['scene_id']} {status_icon} mode={r.get('mode','?')} {r.get('file_size_mb','')}MB")

    return results


def post_production(results: list[dict]):
    print("\n[Phase 4] Post-production...")

    video_paths = []
    for scene in SCENES:
        p = OUTPUT_DIR / f"{scene['id']}.mp4"
        if p.exists():
            video_paths.append(p)

    if not video_paths:
        print("  No video files, skip")
        return

    print(f"  Found {len(video_paths)} clips")

    total_dur = sum(s["duration"] for s in SCENES if (OUTPUT_DIR / f"{s['id']}.mp4").exists())

    user_bgm = OUTPUT_DIR / "bgm.mp3"
    bgm_wav = OUTPUT_DIR / "bgm.wav"

    if user_bgm.exists():
        print(f"  Using user BGM: {user_bgm.name}")
        bgm = user_bgm
    else:
        _generate_simple_bgm(bgm_wav, total_dur + 2)
        bgm = bgm_wav

    final = OUTPUT_DIR / "final_love_story.mp4"
    success = concat_with_bgm(video_paths, bgm, final)

    if success:
        print(f"\n{'='*60}")
        print(f"  Final video ready!")
        print(f"  File: {final}")
        print(f"  Duration: ~{total_dur}s | Clips: {len(video_paths)}")
        print(f"{'='*60}")
        print(f"\n  Better BGM? Put mp3 at: {OUTPUT_DIR / 'bgm.mp3'}")
        print(f"  Then run: python scripts/produce_love_story.py --skip-gen")


async def main():
    skip_gen = "--skip-gen" in sys.argv
    test_scene = None
    for arg in sys.argv[1:]:
        if arg.startswith("--test"):
            idx = sys.argv.index(arg)
            if idx + 1 < len(sys.argv):
                test_scene = sys.argv[idx + 1]

    if skip_gen:
        print("Skipping generation, post-production only...")
        results = []
    else:
        results = await generate_scenes(scene_filter=test_scene)

    if not test_scene:
        post_production(results)


if __name__ == "__main__":
    asyncio.run(main())
