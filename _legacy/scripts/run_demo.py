"""
ReelForge MVP Demo — Brief -> QA 完整链路
==========================================

运行方式:
    # Mock 模式（无需 API Key）
    python scripts/run_demo.py

    # Real LLM + Mock Video
    set OPENAI_API_KEY=sk-xxx
    python scripts/run_demo.py

    # Real LLM + Seedance Video (火山方舟)
    set OPENAI_API_KEY=sk-xxx
    set REELFORGE_VIDEO_PROVIDER=seedance
    set ARK_API_KEY=your-ark-key
    python scripts/run_demo.py

环境变量:
    OPENAI_API_KEY            — OpenAI API Key, 存在时自动启用 LLM
    REELFORGE_MODE            — 强制模式: "mock" | "real"
    REELFORGE_MODEL           — 指定模型: "gpt-4o" | "gpt-4o-mini"
    REELFORGE_VIDEO_PROVIDER  — 视频 provider: "mock" | "seedance"
    REELFORGE_LLM_QA          — LLM QA 开关: "1" = 启用
    REELFORGE_DEMO_FORMAT     — 偏好 format: "challenge" | "showcase" 等
    ARK_API_KEY               — 火山方舟 API Key
    ARK_BASE_URL              — Ark API URL (默认 ark.cn-beijing.volces.com)
    ARK_VIDEO_MODEL           — 模型 (默认 doubao-seedance-1-5-pro-251215)
    ARK_VIDEO_RESOLUTION      — 分辨率: "480p" | "720p" | "1080p"
"""

import asyncio
import json
import sys
import os
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))

if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ── Colors ─────────────────────────────────────────────

USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
CYAN = "\033[96m" if USE_COLOR else ""
GREEN = "\033[92m" if USE_COLOR else ""
YELLOW = "\033[93m" if USE_COLOR else ""
RED = "\033[91m" if USE_COLOR else ""
BOLD = "\033[1m" if USE_COLOR else ""
DIM = "\033[2m" if USE_COLOR else ""
RESET = "\033[0m" if USE_COLOR else ""


def banner(text: str):
    w = 60
    print(f"\n{CYAN}{'=' * w}")
    print(f"  {BOLD}{text}{RESET}{CYAN}")
    print(f"{'=' * w}{RESET}\n")


def step_header(num: int, title: str):
    print(f"\n{YELLOW}-- Step {num}: {title} {'-' * max(1, 40 - len(title))}{RESET}")


def show_result(label: str, data: dict, keys: list[str] | None = None):
    filtered = {k: data.get(k) for k in keys if k in data} if keys else data
    print(f"{GREEN}  [OK] {label}:{RESET}")
    for line in json.dumps(filtered, indent=4, ensure_ascii=False, default=str).split("\n"):
        print(f"    {DIM}{line}{RESET}")


def show_error(msg: str):
    print(f"{RED}  [FAIL] {msg}{RESET}")


def validate_schema(label: str, model_class, data: dict):
    skip_keys = {"_warnings", "_platform_validated", "_validated", "_llm_usage",
                 "_llm_model", "validation_issues",
                 "topic_format", "topic_angle", "topic_priority",
                 "generation_mode"}
    clean = {k: v for k, v in data.items() if k not in skip_keys}
    try:
        model_class(**clean)
        print(f"  {GREEN}[OK] {label} schema validation passed{RESET}")
    except Exception as e:
        print(f"  {YELLOW}[WARN] {label} schema: {e}{RESET}")


# ── Mode Detection ─────────────────────────────────────

def detect_mode() -> tuple[str, object]:
    """
    Returns (mode_label, llm_client_or_None).
    Priority: REELFORGE_MODE env > API key presence > mock
    """
    forced = os.environ.get("REELFORGE_MODE", "").strip().lower()
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    model = os.environ.get("REELFORGE_MODEL", "gpt-4o-mini").strip()

    if forced == "mock":
        return "mock (forced)", None

    has_key = bool(api_key and len(api_key) > 8)

    if forced == "real" or has_key:
        if forced == "real" and not has_key:
            print(f"  {YELLOW}[WARN] REELFORGE_MODE=real but no API key found, falling back to mock{RESET}")
            return "mock (no API key)", None
        try:
            from services.llm.client import LLMClient
            client = LLMClient(default_model=model, api_key=api_key)
            return f"real LLM ({model})", client
        except Exception as e:
            print(f"  {YELLOW}[WARN] Failed to init LLM client: {e}, falling back to mock{RESET}")
            return "mock (LLM init failed)", None

    return "mock (no API key)", None


# ── Demo ───────────────────────────────────────────────

async def run_full_demo():
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")

    mode_label, llm_client = detect_mode()
    mode_short = "REAL" if llm_client else "MOCK"

    banner(f"ReelForge MVP Demo [{mode_short}]")
    print(f"  Time:     {datetime.now().isoformat()}")
    print(f"  Mode:     {mode_label}")
    print(f"  Pipeline: Brief -> Research -> Strategy -> Script -> Video -> QA\n")

    # ── Step 1: Intake ─────────────────────────────────
    step_header(1, "Project Intake (Brief)")
    from pipelines.project_intake import ProjectIntakePipeline

    intake = await ProjectIntakePipeline(llm_client=None).run({
        "raw_requirements": (
            "We are a DTC sneaker brand launching a new collection targeting Gen Z. "
            "We need 3 TikTok videos: one product showcase, one behind-the-scenes, "
            "and one trend-riding video. Budget is standard tier. "
            "Tone should be energetic and authentic. Deadline: 2 weeks."
        ),
        "client_name": "UrbanKicks",
        "client_industry": "fashion",
        "platform": "tiktok",
    })
    if intake.status != "completed":
        show_error(f"Intake failed: {intake.steps[-1].error}")
        return

    brief = intake.final_output["brief"]
    brief["video_count"] = 3
    brief["video_duration_seconds"] = 30
    brief["budget_tier"] = "standard"
    brief["brand_tone"] = "energetic and authentic"
    brief["key_messages"] = ["New Gen Z sneaker collection", "Street-ready style", "Limited drop"]
    show_result("Brief", brief, ["brief_id", "client_name", "platform", "content_goal", "video_count"])
    from schemas.models import Brief as BriefModel
    validate_schema("Brief", BriefModel, brief)

    # ── Step 2: Research ───────────────────────────────
    step_header(2, "Research & Analysis")
    from pipelines.research_analysis import ResearchAnalysisPipeline

    research = await ResearchAnalysisPipeline(llm_client=None).run({"brief": brief})
    if research.status != "completed":
        show_error(f"Research failed: {research.steps[-1].error}")
        return

    report = research.final_output["research_report"]
    show_result("Research", report, ["platform", "industry", "trending_topics", "recommendations"])

    # ── Step 3: Strategy (LLM or Mock) ─────────────────
    step_header(3, f"Strategy Generation [{mode_short}]")
    from pipelines.strategy_generation import StrategyGenerationPipeline

    strategy_result = await StrategyGenerationPipeline(llm_client=llm_client).run({
        "brief": brief,
        "research_report": report,
    })
    if strategy_result.status != "completed":
        show_error(f"Strategy failed: {strategy_result.steps[-1].error}")
        return

    strategy = strategy_result.final_output["strategy"]
    show_result("Strategy", strategy, ["strategy_id", "content_pillars", "topic_suggestions", "agent_version", "prompt_version"])
    from schemas.models import Strategy as StrategyModel
    validate_schema("Strategy", StrategyModel, strategy)

    if strategy.get("_llm_usage"):
        u = strategy["_llm_usage"]
        print(f"  {DIM}  LLM tokens: {u.get('total_tokens', 'N/A')} | model: {strategy.get('_llm_model', 'N/A')}{RESET}")

    # ── Step 4: Script (LLM or Mock) ───────────────────
    step_header(4, f"Script Generation [{mode_short}]")
    from pipelines.script_generation import ScriptGenerationPipeline

    demo_strategy = dict(strategy)
    topics = demo_strategy.get("topic_suggestions", [])
    prefer_fmt = os.environ.get("REELFORGE_DEMO_FORMAT", "").strip().lower()
    if prefer_fmt and topics:
        preferred = [t for t in topics if isinstance(t, dict) and t.get("format", "").lower() == prefer_fmt]
        others = [t for t in topics if t not in preferred]
        if preferred:
            demo_strategy["topic_suggestions"] = preferred + others
            print(f"  {DIM}[demo] Preferred format '{prefer_fmt}' → topic: {preferred[0].get('topic', '?')}{RESET}")

    script_result = await ScriptGenerationPipeline(llm_client=llm_client).run({
        "brief": brief,
        "strategy": demo_strategy,
    })
    if script_result.status != "completed":
        show_error(f"Script failed: {script_result.steps[-1].error}")
        return

    script = script_result.final_output["script"]
    show_result("Script", script, [
        "script_id", "title", "hook", "cta", "duration_seconds",
        "platform", "language", "generation_mode",
        "status", "topic_format", "topic_angle", "topic_priority", "agent_version",
    ])
    from schemas.models import Script as ScriptModel
    validate_schema("Script", ScriptModel, script)

    if script.get("_llm_usage"):
        u = script["_llm_usage"]
        print(f"  {DIM}  LLM tokens: {u.get('total_tokens', 'N/A')} | model: {script.get('_llm_model', 'N/A')}{RESET}")

    if script.get("voiceover_text"):
        vt = script["voiceover_text"]
        preview = vt[:120] + "..." if len(vt) > 120 else vt
        print(f"  {DIM}  Voiceover: {preview}{RESET}")

    vds = script.get("visual_directions", [])
    print(f"  {DIM}  Visual directions: {len(vds)} scene(s){RESET}")

    # ── Step 5: Video ────────────────────────────────────
    video_provider = os.environ.get("REELFORGE_VIDEO_PROVIDER", "mock").strip().lower()
    step_header(5, f"Video Generation [{video_provider.upper()}]")
    from pipelines.video_generation import VideoGenerationPipeline
    from services.video.generator import VideoProvider as VP

    try:
        vp = VP(video_provider)
    except ValueError:
        print(f"  {YELLOW}[WARN] Unknown provider '{video_provider}', falling back to mock{RESET}")
        vp = VP.MOCK

    provider_kwargs: dict[str, str] = {}
    if vp == VP.SEEDANCE:
        ark_key = os.environ.get("ARK_API_KEY", "").strip()
        if not ark_key:
            show_error("ARK_API_KEY not set — cannot use seedance provider")
            return
        provider_kwargs["api_key"] = ark_key
        if os.environ.get("ARK_BASE_URL", "").strip():
            provider_kwargs["base_url"] = os.environ["ARK_BASE_URL"].strip()
        if os.environ.get("ARK_VIDEO_MODEL", "").strip():
            provider_kwargs["model"] = os.environ["ARK_VIDEO_MODEL"].strip()
        if os.environ.get("ARK_VIDEO_RESOLUTION", "").strip():
            provider_kwargs["resolution"] = os.environ["ARK_VIDEO_RESOLUTION"].strip()
        print(f"  {DIM}Seedance/Ark config: resolution={provider_kwargs.get('resolution', '720p')}, "
              f"model={provider_kwargs.get('model', 'doubao-seedance-1-5-pro-251215')}{RESET}")

    video_result = await VideoGenerationPipeline(provider=vp, **provider_kwargs).run({"script": script})
    if video_result.status != "completed":
        show_error(f"Video failed: {video_result.steps[-1].error}")
        return

    video_job = video_result.final_output["video_job"]
    show_result("Video Job", video_job, [
        "job_id", "status", "provider", "model", "output_url",
        "duration_requested", "aspect_ratio", "attempt_count",
    ])

    vj_cost = video_job.get("cost_cents", 0)
    vj_est = video_job.get("estimated_cost_cents", 0)
    vj_time = video_job.get("processing_time_ms", 0)
    vj_meta = video_job.get("output_metadata", {})
    print(f"  {DIM}  Cost: {vj_cost}¢ (estimated: {vj_est}¢) | Time: {vj_time}ms{RESET}")
    print(f"  {DIM}  Resolution: {vj_meta.get('resolution', 'N/A')} | "
          f"Size: {vj_meta.get('file_size_bytes', 0) / 1_000_000:.1f}MB | "
          f"Format: {vj_meta.get('format', 'N/A')}{RESET}")
    if video_job.get("started_at"):
        print(f"  {DIM}  Started: {video_job['started_at'][:19]} | "
              f"Completed: {(video_job.get('completed_at') or 'N/A')[:19]}{RESET}")

    from schemas.models import VideoJob as VideoJobModel
    validate_schema("VideoJob", VideoJobModel, video_job)

    # ── Step 6: QA ──────────────────────────────────────
    enable_llm_qa = os.environ.get("REELFORGE_LLM_QA", "").strip() == "1"
    qa_llm = llm_client if enable_llm_qa else None
    qa_mode_label = "RULES+LLM" if qa_llm else "RULES v2"
    step_header(6, f"QA Review [{qa_mode_label}]")
    from pipelines.qa_review import QAReviewPipeline

    qa_result = await QAReviewPipeline(llm_client=qa_llm).run({
        "video_job": video_job,
        "script": script,
        "brief": brief,
        "strategy": strategy,
        "enable_llm_review": enable_llm_qa,
    })
    if qa_result.status != "completed":
        show_error(f"QA failed: {qa_result.steps[-1].error}")
        return

    qa_report = qa_result.final_output["qa_report"]
    review_route = qa_result.final_output.get("review_route", "unknown")

    show_result("QA Summary", qa_report, [
        "qa_report_id", "overall_score", "auto_pass", "review_mode", "agent_version",
    ])
    from schemas.models import QAReport as QAReportModel
    validate_schema("QAReport", QAReportModel, qa_report)

    breakdown = qa_report.get("score_breakdown", {})
    if breakdown:
        print(f"\n  {BOLD}Score Breakdown:{RESET}")
        for dim_name, dim_data in breakdown.items():
            if dim_name == "llm_review":
                continue
            if isinstance(dim_data, dict) and "score" in dim_data:
                s = dim_data["score"]
                w = dim_data.get("weight", 0)
                d = dim_data.get("details", "")
                color = GREEN if s >= 80 else (YELLOW if s >= 60 else RED)
                bar = "█" * (s // 10) + "░" * (10 - s // 10)
                print(f"    {color}{bar} {s:3d}/100{RESET}  {dim_name} (w={w:.2f})  {DIM}{d}{RESET}")

        llm_review = breakdown.get("llm_review")
        if llm_review and isinstance(llm_review, dict):
            print(f"\n  {BOLD}LLM Review:{RESET}")
            for key in ["angle_alignment_score", "content_quality_score", "platform_fit_score"]:
                val = llm_review.get(key)
                if val is not None:
                    color = GREEN if val >= 80 else (YELLOW if val >= 60 else RED)
                    bar = "█" * (val // 10) + "░" * (10 - val // 10)
                    label = key.replace("_score", "").replace("_", " ")
                    print(f"    {color}{bar} {val:3d}/100{RESET}  {label}")
            summary = llm_review.get("summary", "")
            if summary:
                print(f"    {DIM}Summary: {summary}{RESET}")
            llm_tokens = llm_review.get("_llm_tokens", 0)
            if llm_tokens:
                print(f"    {DIM}LLM QA tokens: {llm_tokens}{RESET}")

    qa_issues = qa_report.get("issues", [])
    if qa_issues:
        print(f"\n  {BOLD}Issues ({len(qa_issues)}):{RESET}")
        for issue in qa_issues:
            sev = issue.get("severity", "info")
            sev_color = RED if sev == "critical" else (YELLOW if sev in ("major", "warning") else DIM)
            print(f"    {sev_color}[{sev.upper()}]{RESET} {issue.get('message', issue.get('description', ''))}")

    qa_suggestions = qa_report.get("suggestions", [])
    if qa_suggestions and qa_suggestions != ["当前内容质量达标"]:
        print(f"\n  {BOLD}Suggestions:{RESET}")
        for sug in qa_suggestions[:5]:
            print(f"    {DIM}→ {sug}{RESET}")

    # ── Summary ────────────────────────────────────────
    banner(f"Pipeline Complete [{mode_short}]")

    print(f"  Client:       {brief.get('client_name')}")
    print(f"  Platform:     {brief.get('platform')}")
    print(f"  Mode:         {mode_label}")
    print(f"  Brief ID:     {brief.get('brief_id', '')[:16]}...")
    print(f"  Script:       {script.get('title')}")
    print(f"  Video:        {video_job.get('provider')}:{video_job.get('model', 'N/A')} | "
          f"{video_job.get('status')} | {video_job.get('cost_cents', 0)}¢ | "
          f"{video_job.get('processing_time_ms', 0)}ms")
    print(f"  QA Score:     {qa_report.get('overall_score')}/100")
    print(f"  Auto Pass:    {qa_report.get('auto_pass')}")
    print(f"  QA Mode:      {qa_report.get('review_mode', 'rules')}")
    print(f"  Review Route: {review_route}")
    print(f"  Issues:       {len(qa_issues)}")
    print(f"  Suggestions:  {len(qa_suggestions)}")

    if llm_client:
        print(f"  LLM Calls:    {llm_client.total_calls}")
        print(f"  Total Tokens: {llm_client.total_tokens_used}")

    print(f"\n{CYAN}{'-' * 60}{RESET}")
    if review_route == "auto_approved":
        print(f"  {GREEN}{BOLD}>> Video auto-approved, ready for delivery{RESET}")
    else:
        print(f"  {YELLOW}{BOLD}>> Video needs human review, routed to review queue{RESET}")
    print(f"{CYAN}{'-' * 60}{RESET}")

    # ── Save output ────────────────────────────────────
    output_dir = Path(__file__).parent.parent / "storage" / "demo_output"
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"demo_{mode_short.lower()}_{ts}.json"
    skip = {"_warnings", "_platform_validated", "_validated", "_llm_usage", "_llm_model", "validation_issues"}
    def clean(obj):
        if isinstance(obj, dict):
            return {k: clean(v) for k, v in obj.items() if k not in skip}
        if isinstance(obj, list):
            return [clean(i) for i in obj]
        return obj

    output = clean({
        "meta": {"mode": mode_label, "timestamp": datetime.now().isoformat()},
        "brief": brief,
        "research_report": report,
        "strategy": strategy,
        "script": script,
        "video_job": video_job,
        "qa_report": qa_report,
        "review_route": review_route,
    })
    output_file.write_text(json.dumps(output, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\n  {DIM}Output saved: {output_file}{RESET}\n")


if __name__ == "__main__":
    asyncio.run(run_full_demo())
