from agents.base import BaseAgent, AgentResult
from typing import Any
import uuid
import json

PROMPT_VERSION = "v1.0"

PLATFORM_CONSTRAINTS = {
    "tiktok": {
        "max_duration": 180,
        "optimal_duration": [15, 30, 60],
        "aspect_ratio": "9:16",
        "max_hashtags": 5,
        "caption_limit": 2200,
    },
    "youtube_shorts": {
        "max_duration": 60,
        "optimal_duration": [30, 60],
        "aspect_ratio": "9:16",
        "max_hashtags": 15,
        "caption_limit": 5000,
    },
    "instagram_reels": {
        "max_duration": 90,
        "optimal_duration": [15, 30, 60],
        "aspect_ratio": "9:16",
        "max_hashtags": 30,
        "caption_limit": 2200,
    },
}


class StrategyAgent(BaseAgent):
    name = "strategy_agent"
    description = "把研究数据转成可执行的内容策略"
    version = "0.2.0"

    def __init__(self, llm_client=None):
        super().__init__()
        self.llm_client = llm_client

    @property
    def mode(self) -> str:
        return "llm" if self.llm_client else "mock"

    def validate_input(self, input_data: dict[str, Any]) -> None:
        required = ["brief", "research_report"]
        missing = [k for k in required if k not in input_data]
        if missing:
            raise ValueError(f"Missing required fields: {missing}")

    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        brief = input_data["brief"]
        report = input_data["research_report"]
        platform = brief.get("platform", "tiktok")
        constraints = self._get_constraints(platform)

        actual_mode = self.mode
        if self.llm_client:
            try:
                strategy = await self._llm_generate(brief, report, constraints)
            except Exception as e:
                self.logger.warning("strategy.llm_fallback", error=str(e))
                strategy = self._mock_generate(brief, report, constraints)
                actual_mode = "llm_fallback"
        else:
            strategy = self._mock_generate(brief, report, constraints)

        strategy["strategy_id"] = strategy.get("strategy_id", uuid.uuid4().hex)
        strategy["brief_id"] = brief.get("brief_id", "")
        strategy["platform"] = platform
        strategy["agent_version"] = self.version
        strategy["prompt_version"] = PROMPT_VERSION if actual_mode == "llm" else ""
        strategy["status"] = "generated"

        warnings = self._rule_validate(strategy, constraints)
        if warnings:
            strategy["_warnings"] = warnings
        strategy["_platform_validated"] = True

        return AgentResult(
            success=True,
            data={"strategy": strategy},
            metadata={"mode": actual_mode, "platform": platform},
        )

    def _get_constraints(self, platform: str) -> dict:
        return PLATFORM_CONSTRAINTS.get(platform, PLATFORM_CONSTRAINTS["tiktok"])

    # ── LLM Mode ───────────────────────────────────────

    async def _llm_generate(self, brief: dict, report: dict, constraints: dict) -> dict:
        self.logger.info("strategy.llm_generate", client=brief.get("client_name"))

        from prompts.loader import load_and_render

        template_vars = {
            "platform": brief.get("platform", "tiktok"),
            "max_duration": constraints["max_duration"],
            "client_name": brief.get("client_name", ""),
            "client_industry": brief.get("client_industry", ""),
            "content_goal": brief.get("content_goal", "brand_awareness"),
            "brand_tone": brief.get("brand_tone", "professional"),
            "video_count": brief.get("video_count", 1),
            "video_duration_seconds": brief.get("video_duration_seconds", 30),
            "key_messages": brief.get("key_messages", []),
            "special_requirements": brief.get("special_requirements", ""),
            "trending_topics": report.get("trending_topics", []),
            "top_formats": report.get("platform_trends", {}).get("top_formats", []),
            "peak_hours": report.get("platform_trends", {}).get("peak_hours", []),
            "competitor_themes": report.get("competitor_analysis", {}).get("themes", []),
            "audience_insights": report.get("audience_insights", {}),
            "optimal_duration": constraints["optimal_duration"],
            "aspect_ratio": constraints["aspect_ratio"],
            "max_hashtags": constraints["max_hashtags"],
        }

        system_prompt = load_and_render("strategy", "system.txt", template_vars)
        user_prompt = load_and_render("strategy", "user.txt", template_vars)

        try:
            result = await self.llm_client.complete_json(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.5,
            )
            strategy = result.get("parsed", {})
            strategy["_llm_usage"] = result.get("usage", {})
            strategy["_llm_model"] = result.get("model", "")
            return strategy
        except Exception as e:
            self.logger.error("strategy.llm_failed", error=str(e))
            raise

    # ── Mock Mode ──────────────────────────────────────

    def _mock_generate(self, brief: dict, report: dict, constraints: dict) -> dict:
        platform = brief.get("platform", "tiktok")
        industry = brief.get("client_industry", "general")
        trending = report.get("trending_topics", [])

        return {
            "content_pillars": [
                f"{industry} industry education",
                "Product use-case showcase",
                "Customer pain points & solutions",
                "Industry trends & insights",
            ],
            "posting_schedule": {
                "frequency": "3_per_week",
                "best_times": report.get("platform_trends", {}).get("peak_hours", [9, 18]),
                "best_days": ["monday", "wednesday", "friday"],
            },
            "tone_guidelines": {
                "voice": "professional_friendly",
                "energy": "medium_high",
                "language_style": "concise, avoid jargon",
                "cta_style": "soft_sell",
            },
            "topic_suggestions": [
                {
                    "topic": f"{industry} beginner guide",
                    "format": "tutorial",
                    "angle": f"Top 3 things every {industry} newcomer should know",
                    "duration": constraints.get("optimal_duration", [30])[0],
                    "priority": "high",
                },
                {
                    "topic": "Product highlights reel",
                    "format": "showcase",
                    "angle": "60-second product tour with key differentiators",
                    "duration": min(60, constraints.get("max_duration", 60)),
                    "priority": "high",
                },
                {
                    "topic": "Common industry myths",
                    "format": "educational",
                    "angle": f"3 myths about {industry} that cost you money",
                    "duration": 30,
                    "priority": "medium",
                },
            ],
            "hashtag_strategy": {
                "primary_tags": trending[:3] if trending else [f"#{industry}"],
                "secondary_tags": trending[3:5] if len(trending) > 3 else ["#viral"],
                "max_per_post": constraints.get("max_hashtags", 5),
            },
        }

    # ── Rule Validation ────────────────────────────────

    def _rule_validate(self, strategy: dict, constraints: dict) -> list[str]:
        warnings = []
        for topic in strategy.get("topic_suggestions", []):
            if isinstance(topic, dict):
                dur = topic.get("duration", 0)
                max_dur = constraints.get("max_duration", 180)
                if dur > max_dur:
                    warnings.append(
                        f"Topic '{topic.get('topic')}' duration {dur}s exceeds platform limit {max_dur}s"
                    )
                    topic["duration"] = max_dur

        hashtags = strategy.get("hashtag_strategy", {})
        max_tags = constraints.get("max_hashtags", 5)
        total_tags = len(hashtags.get("primary_tags", [])) + len(hashtags.get("secondary_tags", []))
        if total_tags > max_tags:
            warnings.append(f"Total hashtags ({total_tags}) exceeds platform limit ({max_tags})")

        return warnings
