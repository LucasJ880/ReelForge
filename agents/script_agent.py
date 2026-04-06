from agents.base import BaseAgent, AgentResult
from typing import Any
import uuid

PROMPT_VERSION = "v2.0"

FORMAT_INSTRUCTIONS = {
    "tutorial": (
        "You MUST write this script in TUTORIAL format.\n"
        "- Structure as a how-to guide with clear steps\n"
        "- Use instructional language: \"here's how\", \"step 1\", \"tip\", \"guide\", \"learn\"\n"
        "- Voiceover should walk the viewer through a process\n"
        "- The hook should promise to teach something valuable"
    ),
    "showcase": (
        "You MUST write this script in SHOWCASE format.\n"
        "- Focus on revealing/introducing a product, collection, or feature\n"
        "- Use language like \"introducing\", \"check out\", \"meet\", \"new launch\", \"reveal\"\n"
        "- Build visual excitement and desire\n"
        "- The hook should create anticipation for what's about to be shown"
    ),
    "behind_the_scenes": (
        "You MUST write this script in BEHIND-THE-SCENES format.\n"
        "- Take the viewer inside a process, workspace, or creation journey\n"
        "- Use language like \"behind the scenes\", \"how we make\", \"sneak peek\", \"inside look\"\n"
        "- Feel raw, authentic, and intimate\n"
        "- The hook should invite the viewer into an exclusive look"
    ),
    "trend": (
        "You MUST write this script in TREND format.\n"
        "- Align with a current platform trend, style, or aesthetic\n"
        "- Use language like \"trend\", \"viral\", \"aesthetic\", \"vibe\", \"this is the look\"\n"
        "- Feel culturally current, timely, and native to the platform\n"
        "- The hook should immediately signal trend relevance"
    ),
    "educational": (
        "You MUST write this script in EDUCATIONAL format.\n"
        "- Teach the viewer something surprising or myth-busting\n"
        "- Use language like \"did you know\", \"myth vs fact\", \"the truth about\", \"here's why\"\n"
        "- Deliver a clear learning takeaway\n"
        "- The hook should spark curiosity with a surprising claim or question"
    ),
    "storytelling": (
        "You MUST write this script in STORYTELLING format.\n"
        "- Tell a narrative with beginning, middle, and emotional payoff\n"
        "- Use language like \"story\", \"journey\", \"imagine\", \"here's what happened\"\n"
        "- Create emotional connection and arc\n"
        "- The hook should set up a compelling narrative premise"
    ),
    "challenge": (
        "You MUST write this script in CHALLENGE format.\n"
        "- Frame the ENTIRE video as a challenge that invites participation\n"
        "- The word \"challenge\" MUST appear in the hook and at least once more in the body\n"
        "- Use language like \"challenge\", \"try this\", \"dare you\", \"can you\", \"show us your\", \"your turn\", \"join the challenge\", \"compete\"\n"
        "- The hook MUST open with a challenge statement or invitation\n"
        "- The CTA MUST invite the viewer to participate, share their attempt, or tag someone\n"
        "- Feel energetic, competitive, and community-driven\n"
        "- Structure: challenge announcement → demonstration → call to participate"
    ),
}
SCHEMA_VERSION = "1.0.0"

DURATION_WORD_MAP = {
    15: {"voiceover_words": 40, "subtitle_chars": 60},
    30: {"voiceover_words": 80, "subtitle_chars": 120},
    60: {"voiceover_words": 160, "subtitle_chars": 240},
    90: {"voiceover_words": 240, "subtitle_chars": 360},
    180: {"voiceover_words": 480, "subtitle_chars": 720},
}


class ScriptAgent(BaseAgent):
    name = "script_agent"
    description = "生成脚本、字幕、口播文案"
    version = "0.3.1"

    def __init__(self, llm_client=None):
        super().__init__()
        self.llm_client = llm_client

    @property
    def mode(self) -> str:
        return "llm" if self.llm_client else "mock"

    def validate_input(self, input_data: dict[str, Any]) -> None:
        required = ["brief", "strategy"]
        missing = [k for k in required if k not in input_data]
        if missing:
            raise ValueError(f"Missing required fields: {missing}")
        if "topic_item" not in input_data and "topic" not in input_data:
            raise ValueError("Missing required field: topic_item or topic")

    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        brief = input_data["brief"]
        strategy = input_data["strategy"]

        topic_item = input_data.get("topic_item")
        if topic_item and isinstance(topic_item, dict):
            topic = topic_item.get("topic", "")
            angle = topic_item.get("angle", "")
            topic_format = topic_item.get("format", "")
            priority = topic_item.get("priority", "medium")
            duration = topic_item.get("duration", brief.get("video_duration_seconds", 30))
        else:
            topic = input_data.get("topic", "")
            angle = ""
            topic_format = ""
            priority = "medium"
            duration = input_data.get("duration_seconds", brief.get("video_duration_seconds", 30))

        constraints = self._get_duration_constraints(duration)

        actual_mode = self.mode
        if self.llm_client:
            try:
                script = await self._llm_generate(
                    brief, strategy, topic, angle, topic_format, priority, duration, constraints
                )
            except Exception as e:
                self.logger.warning("script.llm_fallback", error=str(e))
                script = self._mock_generate(
                    brief, strategy, topic, angle, topic_format, duration, constraints
                )
                actual_mode = "llm_fallback"
        else:
            script = self._mock_generate(
                brief, strategy, topic, angle, topic_format, duration, constraints
            )

        script = self._normalize_script_output(
            script,
            brief=brief,
            topic=topic,
            angle=angle,
            topic_format=topic_format,
            priority=priority,
            duration=duration,
            generation_mode=actual_mode,
        )

        warnings = self._rule_validate(script, constraints, duration)
        if warnings:
            script["_warnings"] = warnings
        script["_validated"] = True

        return AgentResult(
            success=True,
            data={"script": script},
            metadata={
                "mode": actual_mode,
                "topic": topic,
                "angle": angle,
                "format": topic_format,
                "priority": priority,
                "duration": duration,
            },
        )

    # ── Normalize ──────────────────────────────────────

    def _normalize_script_output(
        self,
        script: dict,
        *,
        brief: dict,
        topic: str,
        angle: str,
        topic_format: str,
        priority: str,
        duration: int,
        generation_mode: str,
    ) -> dict:
        """统一清洗和补齐输出字段，无论 LLM 还是 mock 都经过此步"""
        script.setdefault("script_id", uuid.uuid4().hex)
        script.setdefault("title", "")
        script.setdefault("hook", "")
        script.setdefault("body", "")
        script.setdefault("cta", "")
        script.setdefault("voiceover_text", "")
        script.setdefault("subtitle_text", "")
        script.setdefault("visual_directions", [])
        script.setdefault("music_style", "")

        script["brief_id"] = brief.get("brief_id", "")
        script["topic"] = topic
        script["topic_format"] = topic_format
        script["topic_angle"] = angle
        script["topic_priority"] = priority
        script["duration_seconds"] = duration
        script["platform"] = brief.get("platform", "tiktok")
        script["language"] = brief.get("language", "en")
        script["schema_version"] = SCHEMA_VERSION
        script["generation_mode"] = generation_mode
        script["agent_version"] = self.version
        script["prompt_version"] = PROMPT_VERSION
        script["status"] = "draft"

        for i, vd in enumerate(script["visual_directions"]):
            if isinstance(vd, dict):
                vd.setdefault("timestamp", "")
                vd.setdefault("description", "")
                vd.setdefault("text_overlay", "")
                vd.setdefault("transition", "")

        return script

    def _get_duration_constraints(self, duration: int) -> dict:
        closest = min(DURATION_WORD_MAP.keys(), key=lambda d: abs(d - duration))
        return DURATION_WORD_MAP[closest]

    # ── LLM Mode ───────────────────────────────────────

    async def _llm_generate(
        self,
        brief: dict,
        strategy: dict,
        topic: str,
        angle: str,
        topic_format: str,
        priority: str,
        duration: int,
        constraints: dict,
    ) -> dict:
        self.logger.info("script.llm_generate", topic=topic, angle=angle, duration=duration)

        from prompts.loader import load_and_render

        tone = strategy.get("tone_guidelines", {})

        fmt = topic_format or "general"
        format_instr = FORMAT_INSTRUCTIONS.get(
            fmt,
            f"Write the script matching the \"{fmt}\" format naturally.\n"
            f"Use vocabulary and structure that clearly signal this format to the viewer.\n"
            f"The hook should reflect the format style."
        )

        template_vars = {
            "platform": brief.get("platform", "tiktok"),
            "duration_seconds": duration,
            "voiceover_words": constraints["voiceover_words"],
            "subtitle_chars": constraints["subtitle_chars"],
            "language": brief.get("language", "en"),
            "topic": topic,
            "angle": angle or "general overview",
            "format": fmt,
            "priority": priority,
            "client_name": brief.get("client_name", ""),
            "client_industry": brief.get("client_industry", ""),
            "brand_tone": brief.get("brand_tone", "professional"),
            "content_goal": brief.get("content_goal", "brand_awareness"),
            "key_messages": brief.get("key_messages", []),
            "tone_guidelines": tone,
            "format_instructions": format_instr,
        }

        system_prompt = load_and_render("script", "system.txt", template_vars)
        user_prompt = load_and_render("script", "user.txt", template_vars)

        try:
            result = await self.llm_client.complete_json(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.7,
            )
            script = result.get("parsed", {})
            script["_llm_usage"] = result.get("usage", {})
            script["_llm_model"] = result.get("model", "")
            return script
        except Exception as e:
            self.logger.error("script.llm_failed", error=str(e))
            raise

    # ── Mock Mode ──────────────────────────────────────

    def _mock_generate(
        self,
        brief: dict,
        strategy: dict,
        topic: str,
        angle: str,
        topic_format: str,
        duration: int,
        constraints: dict,
    ) -> dict:
        platform = brief.get("platform", "tiktok")
        industry = brief.get("client_industry", "")

        hook_map = {
            "tutorial": f"Want to master {industry} in {duration} seconds?",
            "showcase": f"This {industry} product just changed everything.",
            "educational": f"3 {industry} myths that cost you real money.",
            "behind_the_scenes": f"Here's what really happens behind the scenes at {brief.get('client_name', 'our studio')}.",
        }
        hook = hook_map.get(topic_format, f"Did you know the biggest secret in {industry}?")

        return {
            "title": f"{topic} - {platform} short video",
            "hook": hook,
            "body": (
                f"Today we're diving into {topic} — "
                f"specifically the angle: {angle or 'general overview'}. "
                f"This is something every {industry} professional needs to understand."
            ),
            "cta": "Follow for more industry insights!",
            "voiceover_text": (
                f"Hey everyone! Today let's talk about something crucial — {topic}. "
                f"In the {industry} space, this is often overlooked but incredibly important. "
                f"If you found this useful, hit follow for more content like this!"
            ),
            "subtitle_text": f"{topic} | Must-watch for {industry}",
            "visual_directions": [
                {"timestamp": "0-3s", "description": f"Opening animation + title card: {topic}", "text_overlay": topic, "transition": "zoom_in"},
                {"timestamp": "3-8s", "description": f"Hook visual — {topic_format or 'attention grabber'}", "text_overlay": "", "transition": "cut"},
                {"timestamp": f"8-{max(duration - 5, 9)}s", "description": "Main content with voiceover + B-roll", "text_overlay": "", "transition": "cut"},
                {"timestamp": f"{max(duration - 5, 9)}-{duration}s", "description": "CTA + follow prompt + logo", "text_overlay": "Follow!", "transition": "fade"},
            ],
            "music_style": "upbeat_corporate",
        }

    # ── Rule Validation ────────────────────────────────

    def _rule_validate(self, script: dict, constraints: dict, duration: int) -> list[str]:
        warnings = []

        if not script.get("title"):
            warnings.append("Missing title")
        if not script.get("hook"):
            warnings.append("Missing hook (opening attention grabber)")
        if not script.get("cta"):
            warnings.append("Missing CTA (call to action)")
        if not script.get("voiceover_text"):
            warnings.append("Missing voiceover text")

        voiceover = script.get("voiceover_text", "")
        word_count = len(voiceover.split()) if voiceover else 0
        if word_count > constraints["voiceover_words"] * 1.3:
            warnings.append(
                f"Voiceover word count ({word_count}) may exceed "
                f"comfortable pace for {duration}s video (target: {constraints['voiceover_words']})"
            )

        subtitle = script.get("subtitle_text", "")
        if len(subtitle) > constraints["subtitle_chars"]:
            warnings.append(
                f"Subtitle length ({len(subtitle)}) exceeds limit ({constraints['subtitle_chars']})"
            )

        vds = script.get("visual_directions", [])
        if not vds:
            warnings.append("Missing visual_directions (no scene breakdown)")
        elif len(vds) < 2:
            warnings.append(f"visual_directions only has {len(vds)} scene(s), expect at least 2")
        else:
            for i, vd in enumerate(vds):
                if isinstance(vd, dict) and not vd.get("description"):
                    warnings.append(f"visual_directions[{i}] missing description")

        return warnings
