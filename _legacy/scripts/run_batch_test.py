"""
ReelForge 多 Brief 泛化测试
============================
批量运行不同行业/风格/目标的 brief，验证系统跨场景泛化能力。

运行方式：
    set REELFORGE_MODE=real
    C:\\rf_py312\\python.exe scripts/run_batch_test.py

环境变量：
    REELFORGE_MODE       — mock | real
    REELFORGE_LLM_QA     — 1 启用 LLM QA 二审
    OPENAI_API_KEY       — API key
"""

import asyncio
import json
import sys
import os
import time
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

# ── Test Briefs ──────────────────────────────────────────

TEST_BRIEFS = [
    {
        "id": "B01",
        "client_name": "UrbanKicks",
        "client_industry": "fashion",
        "platform": "tiktok",
        "content_goal": "brand_awareness",
        "brand_tone": "energetic and authentic",
        "video_count": 3,
        "video_duration_seconds": 30,
        "budget_tier": "standard",
        "key_messages": ["New Gen Z sneaker collection", "Street-ready style", "Limited drop"],
        "raw_requirements": "DTC sneaker brand launching a new collection targeting Gen Z. Need TikTok videos with product showcase and trend content.",
    },
    {
        "id": "B02",
        "client_name": "PawPals",
        "client_industry": "pet",
        "platform": "tiktok",
        "content_goal": "engagement",
        "brand_tone": "playful and warm",
        "video_count": 3,
        "video_duration_seconds": 15,
        "budget_tier": "basic",
        "key_messages": ["Organic dog treats", "Vet-approved ingredients", "Happy dogs, happy owners"],
        "raw_requirements": "Organic pet treat brand wanting to build community on TikTok. Need short, fun videos showing dogs enjoying treats.",
    },
    {
        "id": "B03",
        "client_name": "BrightSmile Dental",
        "client_industry": "local service",
        "platform": "tiktok",
        "content_goal": "lead_generation",
        "brand_tone": "trustworthy and friendly",
        "video_count": 2,
        "video_duration_seconds": 30,
        "budget_tier": "basic",
        "key_messages": ["Free first consultation", "Painless modern dentistry", "Family-friendly practice"],
        "raw_requirements": "Local dental clinic wanting to attract new patients via TikTok. Educational content about dental health myths.",
    },
    {
        "id": "B04",
        "client_name": "CodeCamp Academy",
        "client_industry": "education",
        "platform": "tiktok",
        "content_goal": "lead_generation",
        "brand_tone": "inspiring and approachable",
        "video_count": 3,
        "video_duration_seconds": 60,
        "budget_tier": "standard",
        "key_messages": ["Learn to code in 12 weeks", "No prior experience needed", "95% job placement rate"],
        "raw_requirements": "Online coding bootcamp targeting career changers. Need educational and testimonial content on TikTok.",
    },
    {
        "id": "B05",
        "client_name": "LuxeGlow",
        "client_industry": "beauty",
        "platform": "tiktok",
        "content_goal": "product_promotion",
        "brand_tone": "premium and elegant",
        "video_count": 3,
        "video_duration_seconds": 30,
        "budget_tier": "premium",
        "key_messages": ["Clinical-grade skincare", "Visible results in 14 days", "Dermatologist recommended"],
        "raw_requirements": "Premium skincare brand launching a new serum. Need polished TikTok content showing product benefits and results.",
    },
    {
        "id": "B06",
        "client_name": "HandyPro",
        "client_industry": "home improvement",
        "platform": "tiktok",
        "content_goal": "brand_awareness",
        "brand_tone": "practical and reliable",
        "video_count": 2,
        "video_duration_seconds": 60,
        "budget_tier": "basic",
        "key_messages": ["Licensed and insured", "Same-day service", "Free estimates"],
        "raw_requirements": "Home repair service wanting to build brand presence on TikTok with DIY tips and before/after content.",
    },
    {
        "id": "B07",
        "client_name": "TastyBowl",
        "client_industry": "food",
        "platform": "tiktok",
        "content_goal": "engagement",
        "brand_tone": "fun and mouth-watering",
        "video_count": 3,
        "video_duration_seconds": 15,
        "budget_tier": "standard",
        "key_messages": ["Fresh ingredients daily", "Customizable bowls", "Order via app"],
        "raw_requirements": "Fast-casual poke bowl restaurant chain. Need viral food content on TikTok showing bowl assembly and customer reactions.",
    },
    {
        "id": "B08",
        "client_name": "NestFinder",
        "client_industry": "real estate",
        "platform": "tiktok",
        "content_goal": "lead_generation",
        "brand_tone": "professional and trustworthy",
        "video_count": 2,
        "video_duration_seconds": 30,
        "budget_tier": "premium",
        "key_messages": ["First-time buyer specialists", "Virtual tours available", "Zero hidden fees"],
        "raw_requirements": "Real estate agency targeting first-time home buyers. Need property showcase and buyer tips content on TikTok.",
    },
    {
        "id": "B09",
        "client_name": "ZenFlow Studio",
        "client_industry": "fitness",
        "platform": "tiktok",
        "content_goal": "engagement",
        "brand_tone": "calm and motivational",
        "video_count": 3,
        "video_duration_seconds": 30,
        "budget_tier": "basic",
        "key_messages": ["Yoga for all levels", "Mind-body connection", "Free trial class"],
        "raw_requirements": "Yoga and meditation studio wanting to grow TikTok following. Need calming yet engaging content showing poses and routines.",
    },
    {
        "id": "B10",
        "client_name": "SparkTech",
        "client_industry": "technology",
        "platform": "tiktok",
        "content_goal": "product_promotion",
        "brand_tone": "innovative and exciting",
        "video_count": 3,
        "video_duration_seconds": 30,
        "budget_tier": "premium",
        "key_messages": ["AI-powered smart home hub", "Works with 500+ devices", "Setup in 5 minutes"],
        "raw_requirements": "Tech startup launching an AI smart home hub. Need product demo and unboxing content on TikTok targeting early adopters.",
    },
]


# ── Pipeline Runner ──────────────────────────────────────

async def run_single_brief(brief_config: dict, llm_client, enable_llm_qa: bool) -> dict:
    """Run full pipeline for a single brief, return structured result."""
    from pipelines.project_intake import ProjectIntakePipeline
    from pipelines.research_analysis import ResearchAnalysisPipeline
    from pipelines.strategy_generation import StrategyGenerationPipeline
    from pipelines.script_generation import ScriptGenerationPipeline
    from pipelines.video_generation import VideoGenerationPipeline
    from pipelines.qa_review import QAReviewPipeline

    bid = brief_config["id"]
    result = {
        "brief_id": bid,
        "client": brief_config["client_name"],
        "industry": brief_config["client_industry"],
        "goal": brief_config["content_goal"],
        "tone": brief_config["brand_tone"],
        "duration": brief_config["video_duration_seconds"],
        "success": False,
        "error": None,
        "fallback": False,
        "warnings": [],
    }

    t0 = time.monotonic()

    try:
        intake = await ProjectIntakePipeline(llm_client=None).run({
            "raw_requirements": brief_config["raw_requirements"],
            "client_name": brief_config["client_name"],
            "client_industry": brief_config["client_industry"],
            "platform": brief_config["platform"],
        })
        if intake.status != "completed":
            result["error"] = "Intake failed"
            return result

        brief = intake.final_output["brief"]
        brief["video_count"] = brief_config["video_count"]
        brief["video_duration_seconds"] = brief_config["video_duration_seconds"]
        brief["budget_tier"] = brief_config["budget_tier"]
        brief["brand_tone"] = brief_config["brand_tone"]
        brief["key_messages"] = brief_config["key_messages"]

        research = await ResearchAnalysisPipeline(llm_client=None).run({"brief": brief})
        if research.status != "completed":
            result["error"] = "Research failed"
            return result
        report = research.final_output["research_report"]

        strategy_result = await StrategyGenerationPipeline(llm_client=llm_client).run({
            "brief": brief, "research_report": report,
        })
        if strategy_result.status != "completed":
            result["error"] = "Strategy failed"
            return result
        strategy = strategy_result.final_output["strategy"]

        result["strategy_pillars"] = strategy.get("content_pillars", [])
        topics = strategy.get("topic_suggestions", [])
        result["strategy_topics"] = [
            {"topic": t.get("topic", ""), "format": t.get("format", ""), "priority": t.get("priority", "")}
            for t in topics[:3] if isinstance(t, dict)
        ]
        result["strategy_mode"] = strategy.get("generation_mode", "unknown")

        if strategy.get("generation_mode") == "mock" and llm_client:
            result["fallback"] = True

        script_result = await ScriptGenerationPipeline(llm_client=llm_client).run({
            "brief": brief, "strategy": strategy,
        })
        if script_result.status != "completed":
            result["error"] = "Script failed"
            return result
        script = script_result.final_output["script"]

        result["script_title"] = script.get("title", "")
        result["script_format"] = script.get("topic_format", "")
        result["script_angle"] = script.get("topic_angle", "")[:80]
        result["script_mode"] = script.get("generation_mode", "unknown")
        result["script_warnings"] = script.get("_warnings", [])

        if script.get("generation_mode") == "llm_fallback":
            result["fallback"] = True
        if script.get("_warnings"):
            result["warnings"].extend(script["_warnings"])

        video_result = await VideoGenerationPipeline().run({"script": script})
        if video_result.status != "completed":
            result["error"] = "Video failed"
            return result
        video_job = video_result.final_output["video_job"]

        qa_llm = llm_client if enable_llm_qa else None
        qa_result = await QAReviewPipeline(llm_client=qa_llm).run({
            "video_job": video_job, "script": script,
            "brief": brief, "strategy": strategy,
            "enable_llm_review": enable_llm_qa,
        })
        if qa_result.status != "completed":
            result["error"] = "QA failed"
            return result

        qa_report = qa_result.final_output["qa_report"]
        result["qa_score"] = qa_report.get("overall_score", 0)
        result["qa_auto_pass"] = qa_report.get("auto_pass", False)
        result["qa_mode"] = qa_report.get("review_mode", "rules")
        result["review_route"] = qa_result.final_output.get("review_route", "unknown")

        breakdown = qa_report.get("score_breakdown", {})
        result["scores"] = {}
        for dim, data in breakdown.items():
            if dim == "llm_review":
                result["llm_review"] = {
                    k: data.get(k) for k in
                    ["angle_alignment_score", "content_quality_score", "platform_fit_score", "summary"]
                    if data.get(k) is not None
                }
                continue
            if isinstance(data, dict) and "score" in data:
                result["scores"][dim] = data["score"]

        issues = qa_report.get("issues", [])
        result["issue_count"] = len(issues)
        result["critical_issues"] = [i["message"] for i in issues if i.get("severity") == "critical"]

        result["success"] = True
        result["elapsed_ms"] = int((time.monotonic() - t0) * 1000)

    except Exception as e:
        result["error"] = str(e)
        result["elapsed_ms"] = int((time.monotonic() - t0) * 1000)

    return result


# ── Main ─────────────────────────────────────────────────

async def main():
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")

    forced = os.environ.get("REELFORGE_MODE", "").strip().lower()
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    model = os.environ.get("REELFORGE_MODEL", "gpt-4o-mini").strip()
    enable_llm_qa = os.environ.get("REELFORGE_LLM_QA", "").strip() == "1"

    llm_client = None
    has_key = bool(api_key and len(api_key) > 8)
    if (forced == "real" or has_key) and forced != "mock":
        try:
            from services.llm.client import LLMClient
            llm_client = LLMClient(default_model=model, api_key=api_key)
        except Exception as e:
            print(f"[WARN] LLM init failed: {e}")

    mode = "REAL" if llm_client else "MOCK"
    qa_label = "rules+llm" if enable_llm_qa and llm_client else "rules"

    print("=" * 70)
    print(f"  ReelForge Batch Test — {len(TEST_BRIEFS)} briefs [{mode}] [QA: {qa_label}]")
    print(f"  Time: {datetime.now().isoformat()}")
    print("=" * 70)

    results = []
    for i, bc in enumerate(TEST_BRIEFS):
        print(f"\n--- [{i+1}/{len(TEST_BRIEFS)}] {bc['id']}: {bc['client_name']} ({bc['client_industry']}) ---")
        r = await run_single_brief(bc, llm_client, enable_llm_qa and llm_client is not None)
        results.append(r)

        status = "OK" if r["success"] else f"FAIL: {r.get('error', '?')}"
        score = r.get("qa_score", "N/A")
        route = r.get("review_route", "?")
        fb = " [FALLBACK]" if r.get("fallback") else ""
        print(f"    Score: {score}/100 | Route: {route} | {status}{fb} | {r.get('elapsed_ms', 0)}ms")

        if r.get("scores"):
            low = {k: v for k, v in r["scores"].items() if v < 70}
            if low:
                print(f"    Low dims: {low}")

    print("\n" + "=" * 70)
    print("  BATCH RESULTS SUMMARY")
    print("=" * 70)

    passed = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]

    print(f"\n  Total: {len(results)} | Passed: {len(passed)} | Failed: {len(failed)}")

    if passed:
        scores = [r["qa_score"] for r in passed]
        print(f"  QA Scores: min={min(scores)} max={max(scores)} avg={sum(scores)/len(scores):.1f}")
        auto_pass = sum(1 for r in passed if r.get("qa_auto_pass"))
        print(f"  Auto-approved: {auto_pass}/{len(passed)}")
        fallbacks = sum(1 for r in passed if r.get("fallback"))
        print(f"  Fallbacks: {fallbacks}/{len(passed)}")

    if failed:
        print(f"\n  Failed briefs:")
        for r in failed:
            print(f"    {r['brief_id']} ({r['client']}): {r.get('error', '?')}")

    print(f"\n  --- Per-Brief Breakdown ---")
    header = f"  {'ID':<5} {'Client':<18} {'Industry':<14} {'Score':>5} {'Route':<16} {'Format':<12}"
    print(header)
    print("  " + "-" * len(header.strip()))
    for r in results:
        if not r["success"]:
            print(f"  {r['brief_id']:<5} {r['client']:<18} {r['industry']:<14} {'FAIL':>5} {'-':<16} {'-':<12}")
            continue
        fmt = r.get("script_format", "?")
        print(f"  {r['brief_id']:<5} {r['client']:<18} {r['industry']:<14} {r['qa_score']:>5} {r.get('review_route', '?'):<16} {fmt:<12}")

    if passed:
        print(f"\n  --- Dimension Scores ---")
        all_dims = set()
        for r in passed:
            all_dims.update(r.get("scores", {}).keys())
        dims = sorted(all_dims)

        dim_header = f"  {'ID':<5} " + " ".join(f"{d[:8]:>8}" for d in dims)
        print(dim_header)
        print("  " + "-" * len(dim_header.strip()))
        for r in passed:
            sc = r.get("scores", {})
            vals = " ".join(f"{sc.get(d, 0):>8}" for d in dims)
            print(f"  {r['brief_id']:<5} {vals}")

        print(f"\n  --- Dimension Averages ---")
        for d in dims:
            vals = [r["scores"].get(d, 0) for r in passed if d in r.get("scores", {})]
            if vals:
                avg = sum(vals) / len(vals)
                lo = min(vals)
                hi = max(vals)
                color_mark = " <<<" if avg < 70 else ""
                print(f"    {d:<20} avg={avg:5.1f}  min={lo:3d}  max={hi:3d}{color_mark}")

        print(f"\n  --- By Industry ---")
        by_ind = {}
        for r in passed:
            by_ind.setdefault(r["industry"], []).append(r["qa_score"])
        for ind in sorted(by_ind):
            vals = by_ind[ind]
            print(f"    {ind:<18} avg={sum(vals)/len(vals):5.1f}  n={len(vals)}")

        print(f"\n  --- By Format ---")
        by_fmt = {}
        for r in passed:
            f = r.get("script_format", "unknown")
            by_fmt.setdefault(f, []).append(r["qa_score"])
        for f in sorted(by_fmt):
            vals = by_fmt[f]
            print(f"    {f:<18} avg={sum(vals)/len(vals):5.1f}  n={len(vals)}")

        print(f"\n  --- By Content Goal ---")
        by_goal = {}
        for r in passed:
            by_goal.setdefault(r["goal"], []).append(r["qa_score"])
        for g in sorted(by_goal):
            vals = by_goal[g]
            print(f"    {g:<22} avg={sum(vals)/len(vals):5.1f}  n={len(vals)}")

    if llm_client:
        print(f"\n  LLM Usage: {llm_client.total_calls} calls, {llm_client.total_tokens_used} tokens")

    output_dir = Path(__file__).parent.parent / "storage" / "batch_test"
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"batch_{mode.lower()}_{ts}.json"
    output_file.write_text(
        json.dumps(results, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    print(f"\n  Results saved: {output_file}")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
