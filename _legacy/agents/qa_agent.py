from agents.base import BaseAgent, AgentResult
from typing import Any
import uuid
import re
import math

TECHNICAL_THRESHOLDS = {
    "min_duration_seconds": 5,
    "max_duration_seconds": 600,
    "min_resolution_height": 720,
    "max_file_size_mb": 500,
    "supported_formats": ["mp4", "mov", "webm"],
}

AUTO_PASS_THRESHOLD = 80

SCORE_WEIGHTS = {
    "hook_quality":     0.15,
    "topic_alignment":  0.15,
    "angle_alignment":  0.12,
    "format_alignment": 0.10,
    "cta_quality":      0.10,
    "duration_fitness": 0.13,
    "brief_alignment":  0.10,
    "technical":        0.15,
}

HOOK_POWER_WORDS = {
    "secret", "shocking", "surprising", "truth", "hack", "mistake",
    "stop", "wait", "never", "always", "best", "worst", "free",
    "crazy", "insane", "ultimate", "ready", "imagine", "discover",
    "check", "watch", "look", "coolest", "hottest", "fastest",
}

CTA_ACTION_VERBS = {
    "follow", "like", "share", "comment", "subscribe", "click",
    "tap", "save", "check", "visit", "grab", "get", "try",
    "hit", "smash", "drop", "join", "tag", "dm", "link",
}

FORMAT_SIGNALS = {
    "tutorial": {
        "keywords": [
            "how to", "step", "tip", "guide", "learn", "teach", "way to",
            "method", "tutorial", "show you", "here's how", "easy", "simple",
            "follow", "trick", "hack", "secret", "quick",
        ],
        "structure": "step-by-step or instructional flow",
    },
    "showcase": {
        "keywords": [
            "introducing", "check out", "meet", "new", "launch", "feature",
            "design", "unbox", "reveal", "collection", "discover", "best",
            "highlight", "exclusive", "special", "premium", "perfect",
            "amazing", "presenting", "look at",
        ],
        "structure": "product-focused reveal or display",
    },
    "behind_the_scenes": {
        "keywords": [
            "behind", "scene", "process", "making", "how we", "inside",
            "exclusive", "sneak peek", "backstage", "real", "our team",
            "workspace", "studio", "creating", "crafting", "journey",
            "building", "secret",
        ],
        "structure": "process or journey narrative",
    },
    "trend": {
        "keywords": [
            "trend", "viral", "challenge", "style", "outfit", "look",
            "fit", "aesthetic", "vibe", "inspo", "everyone", "obsessed",
            "love", "hot", "popular", "moment", "right now",
        ],
        "structure": "trend-following or culture-native",
    },
    "educational": {
        "keywords": [
            "myth", "fact", "truth", "did you know", "reason", "why",
            "because", "explain", "understand", "learn", "know",
            "mistake", "actually", "most people", "common", "important",
            "need to know", "secret",
        ],
        "structure": "informational or myth-busting",
    },
    "storytelling": {
        "keywords": [
            "story", "journey", "experience", "moment", "remember",
            "one day", "imagine", "feel", "emotion", "life", "changed",
            "discovered", "realized", "transform", "before", "after",
            "dream", "passion", "believe",
        ],
        "structure": "narrative arc",
    },
    "challenge": {
        "keywords": [
            "challenge", "try", "dare", "can you", "bet", "versus", "vs",
            "compete", "win", "race", "show us", "your turn", "join",
            "tag", "participate",
        ],
        "structure": "participatory or competitive",
    },
}


def _word_count(text: str) -> int:
    return len(text.split()) if text else 0


def _text_contains_any(text: str, keywords: list[str]) -> list[str]:
    text_lower = text.lower()
    return [kw for kw in keywords if kw.lower() in text_lower]


def _fuzzy_word_in_text(word: str, text: str) -> bool:
    """Check if word appears in text, with basic stem tolerance (plural/singular)."""
    if word in text:
        return True
    if word.endswith("s") and word[:-1] in text:
        return True
    if not word.endswith("s") and (word + "s") in text:
        return True
    if word.endswith("ing") and word[:-3] in text:
        return True
    return False


def _extract_all_text(script: dict) -> str:
    parts = [
        script.get("title", ""),
        script.get("hook", ""),
        script.get("body", ""),
        script.get("cta", ""),
        script.get("voiceover_text", ""),
    ]
    for vd in script.get("visual_directions", []):
        if isinstance(vd, dict):
            parts.append(vd.get("description", ""))
            parts.append(vd.get("text_overlay", ""))
    return " ".join(parts)


class QAAgent(BaseAgent):
    name = "qa_agent"
    description = "视频评分、问题检测、修改建议（7 维度规则引擎 + 可选 LLM 二审）"
    version = "0.6.0"

    def __init__(self, llm_client=None):
        super().__init__()
        self.llm_client = llm_client

    def validate_input(self, input_data: dict[str, Any]) -> None:
        required = ["video_job", "script", "brief"]
        missing = [k for k in required if k not in input_data]
        if missing:
            raise ValueError(f"缺少必要字段: {missing}")

    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        video_job = input_data["video_job"]
        script = input_data["script"]
        brief = input_data["brief"]
        strategy = input_data.get("strategy", {})

        breakdown = {}
        all_issues: list[dict] = []
        all_suggestions: list[str] = []

        tech = self._score_technical(video_job)
        breakdown["technical"] = tech
        all_issues.extend(tech.get("issues", []))

        for name, scorer in [
            ("hook_quality",    lambda: self._score_hook(script)),
            ("topic_alignment", lambda: self._score_topic_alignment(script)),
            ("angle_alignment", lambda: self._score_angle_alignment(script, strategy)),
            ("format_alignment", lambda: self._score_format_alignment(script)),
            ("cta_quality",     lambda: self._score_cta(script)),
            ("duration_fitness", lambda: self._score_duration_fitness(script)),
            ("brief_alignment", lambda: self._score_brief_alignment(script, brief)),
        ]:
            result = scorer()
            breakdown[name] = result
            all_issues.extend(result.get("issues", []))
            all_suggestions.extend(result.get("suggestions", []))

        overall = self._compute_overall(breakdown)

        has_critical = any(i.get("severity") == "critical" for i in all_issues)
        auto_pass = overall >= AUTO_PASS_THRESHOLD and not has_critical

        enable_llm = input_data.get("enable_llm_review", False)
        review_mode = "rules"
        if self.llm_client and enable_llm:
            try:
                llm_result = await self._llm_review_content(script, brief, strategy)
                breakdown["llm_review"] = llm_result
                review_mode = "rules+llm"

                self._blend_llm_scores(breakdown, llm_result, all_issues, all_suggestions)
                overall = self._compute_overall(breakdown)
                has_critical = any(i.get("severity") == "critical" for i in all_issues)
                auto_pass = overall >= AUTO_PASS_THRESHOLD and not has_critical
            except Exception as e:
                self.logger.warning("qa.llm_review_skipped", error=str(e))

        qa_report = {
            "qa_report_id": uuid.uuid4().hex,
            "script_id": script.get("script_id"),
            "job_id": video_job.get("job_id"),
            "overall_score": overall,
            "score_breakdown": breakdown,
            "issues": all_issues,
            "suggestions": all_suggestions or ["当前内容质量达标"],
            "auto_pass": auto_pass,
            "auto_pass_threshold": AUTO_PASS_THRESHOLD,
            "review_mode": review_mode,
            "agent_version": self.version,
        }

        return AgentResult(
            success=True,
            data={"qa_report": qa_report},
            metadata={"overall_score": overall, "review_mode": review_mode},
        )

    # ── Overall Score ──────────────────────────────────

    def _compute_overall(self, breakdown: dict) -> int:
        total = 0.0
        total_weight = 0.0
        for dim, weight in SCORE_WEIGHTS.items():
            entry = breakdown.get(dim, {})
            score = entry.get("score", 0)
            total += score * weight
            total_weight += weight
        if total_weight > 0:
            return int(round(total / total_weight))
        return 0

    # ── 1. Technical ───────────────────────────────────

    def _score_technical(self, video_job: dict) -> dict:
        issues = []
        metadata = video_job.get("output_metadata") or video_job.get("metadata", {})

        duration = metadata.get("duration", 0)
        if duration < TECHNICAL_THRESHOLDS["min_duration_seconds"]:
            issues.append({"type": "technical", "severity": "critical",
                           "message": f"视频时长 {duration}s 低于最低要求 {TECHNICAL_THRESHOLDS['min_duration_seconds']}s"})
        if duration > TECHNICAL_THRESHOLDS["max_duration_seconds"]:
            issues.append({"type": "technical", "severity": "critical",
                           "message": f"视频时长 {duration}s 超过最大限制 {TECHNICAL_THRESHOLDS['max_duration_seconds']}s"})

        resolution = metadata.get("resolution", "")
        if resolution:
            try:
                height = int(resolution.split("x")[-1])
                if height < TECHNICAL_THRESHOLDS["min_resolution_height"]:
                    issues.append({"type": "technical", "severity": "warning",
                                   "message": f"分辨率 {resolution} 低于推荐 {TECHNICAL_THRESHOLDS['min_resolution_height']}p"})
            except (ValueError, IndexError):
                pass

        error_count = sum(1 for i in issues if i["severity"] == "critical")
        warn_count = len(issues) - error_count
        score = max(0, 100 - error_count * 40 - warn_count * 10)

        return {"score": score, "weight": SCORE_WEIGHTS["technical"],
                "details": f"{len(issues)} issue(s)", "issues": issues}

    # ── 2. Hook Quality ────────────────────────────────

    def _score_hook(self, script: dict) -> dict:
        hook = script.get("hook", "").strip()
        issues = []
        suggestions = []
        score = 100

        if not hook:
            return {"score": 0, "weight": SCORE_WEIGHTS["hook_quality"],
                    "details": "Missing hook",
                    "issues": [{"type": "content", "severity": "critical",
                                "message": "脚本缺少 Hook（开头吸引语）"}],
                    "suggestions": ["添加前 3 秒的 Hook，用提问、大胆断言或视觉冲击开场"]}

        words = _word_count(hook)
        if words < 3:
            score -= 25
            issues.append({"type": "content", "severity": "major",
                           "message": f"Hook 过短（{words} 词），不足以在 3 秒内抓住注意力"})
            suggestions.append("Hook 建议 5-20 个词，能在 3 秒内说完")
        elif words > 25:
            score -= 15
            issues.append({"type": "content", "severity": "minor",
                           "message": f"Hook 过长（{words} 词），可能超过 3 秒"})
            suggestions.append("精简 Hook 到 20 词以内")

        has_question = "?" in hook
        has_exclamation = "!" in hook
        hook_lower = hook.lower()
        power_hits = [w for w in HOOK_POWER_WORDS if w in hook_lower]

        attention_signals = sum([has_question, has_exclamation, len(power_hits) > 0])
        if attention_signals == 0:
            score -= 20
            issues.append({"type": "content", "severity": "minor",
                           "message": "Hook 缺少注意力触发元素（无提问、感叹或强力词）"})
            suggestions.append("在 Hook 中使用提问句、感叹号或强力词（如 secret, ready, check out）")
        elif attention_signals >= 2:
            score = min(100, score + 5)

        details = f"{words}w, signals={attention_signals}"
        if power_hits:
            details += f", power_words={power_hits[:3]}"

        return {"score": max(0, score), "weight": SCORE_WEIGHTS["hook_quality"],
                "details": details, "issues": issues, "suggestions": suggestions}

    # ── 3. Topic Alignment ─────────────────────────────

    def _score_topic_alignment(self, script: dict) -> dict:
        topic = script.get("topic", "").strip()
        if not topic:
            return {"score": 50, "weight": SCORE_WEIGHTS["topic_alignment"],
                    "details": "No topic metadata",
                    "issues": [{"type": "content", "severity": "minor",
                                "message": "脚本缺少 topic 元数据，无法评估主题对齐"}],
                    "suggestions": []}

        topic_words = set(re.findall(r'\w{3,}', topic.lower()))
        if not topic_words:
            return {"score": 50, "weight": SCORE_WEIGHTS["topic_alignment"],
                    "details": "Topic too short to analyze", "issues": [], "suggestions": []}

        all_text = _extract_all_text(script).lower()
        title = script.get("title", "").lower()
        body = script.get("body", "").lower()
        voiceover = script.get("voiceover_text", "").lower()

        stopwords = {"the", "and", "for", "with", "that", "this", "are", "was", "from", "new", "how", "its"}
        content_words = topic_words - stopwords
        if not content_words:
            content_words = topic_words

        title_hits = sum(1 for w in content_words if _fuzzy_word_in_text(w, title))
        body_hits = sum(1 for w in content_words if _fuzzy_word_in_text(w, body))
        voiceover_hits = sum(1 for w in content_words if _fuzzy_word_in_text(w, voiceover))

        title_ratio = title_hits / len(content_words) if content_words else 0
        body_ratio = body_hits / len(content_words) if content_words else 0
        vo_ratio = voiceover_hits / len(content_words) if content_words else 0

        score = int(title_ratio * 30 + body_ratio * 35 + vo_ratio * 35)
        score = min(100, max(0, score))

        issues = []
        suggestions = []
        if title_ratio < 0.3:
            issues.append({"type": "content", "severity": "minor",
                           "message": f"标题与主题关键词重合度低 ({title_ratio:.0%})"})
            suggestions.append(f"建议标题更明确地提及主题: {topic}")
        if body_ratio < 0.3:
            issues.append({"type": "content", "severity": "warning",
                           "message": f"正文与主题关键词重合度低 ({body_ratio:.0%})"})

        matched = [w for w in content_words if _fuzzy_word_in_text(w, all_text)]
        details = f"topic_words={list(content_words)[:5]}, matched={matched[:5]}, coverage={score}%"
        return {"score": score, "weight": SCORE_WEIGHTS["topic_alignment"],
                "details": details, "issues": issues, "suggestions": suggestions}

    # ── 4. Angle Alignment ─────────────────────────────

    def _score_angle_alignment(self, script: dict, strategy: dict) -> dict:
        angle = script.get("topic_angle", "").strip()
        if not angle:
            return {"score": 60, "weight": SCORE_WEIGHTS["angle_alignment"],
                    "details": "No angle metadata", "issues": [], "suggestions": []}

        angle_words = set(re.findall(r'\w{4,}', angle.lower()))
        stopwords = {"that", "this", "with", "from", "their", "they", "have", "been",
                     "will", "about", "which", "into", "create", "video", "featuring"}
        meaningful = angle_words - stopwords
        if not meaningful:
            meaningful = angle_words

        all_text = _extract_all_text(script).lower()
        hits = [w for w in meaningful if w in all_text]
        ratio = len(hits) / len(meaningful) if meaningful else 0

        score = int(ratio * 100)
        score = min(100, max(0, score))

        issues = []
        suggestions = []
        if ratio < 0.3:
            issues.append({"type": "content", "severity": "major",
                           "message": f"脚本内容与策略 angle 对齐度低 ({ratio:.0%})"})
            suggestions.append(f"脚本应更明确体现策略 angle: \"{angle[:80]}\"")

        details = f"angle_keywords={list(meaningful)[:5]}, hits={len(hits)}/{len(meaningful)}"
        return {"score": score, "weight": SCORE_WEIGHTS["angle_alignment"],
                "details": details, "issues": issues, "suggestions": suggestions}

    # ── 5. Format Alignment ────────────────────────────

    def _score_format_alignment(self, script: dict) -> dict:
        fmt = script.get("topic_format", "").strip().lower()
        if not fmt or fmt not in FORMAT_SIGNALS:
            return {"score": 60, "weight": SCORE_WEIGHTS["format_alignment"],
                    "details": f"Unknown format '{fmt}'",
                    "issues": [], "suggestions": []}

        signals = FORMAT_SIGNALS[fmt]
        all_text = _extract_all_text(script).lower()
        hits = _text_contains_any(all_text, signals["keywords"])

        hit_count = len(hits)
        total_kw = len(signals["keywords"])
        target = max(total_kw * 0.4, 1)

        if hit_count == 0:
            score = 40
        else:
            normalized = min(1.0, hit_count / target)
            score = int(50 + normalized * 50)
        score = min(100, score)

        issues = []
        suggestions = []
        if hit_count == 0:
            issues.append({"type": "content", "severity": "minor",
                           "message": f"脚本中未检测到 '{fmt}' 格式特征信号"})
            suggestions.append(f"'{fmt}' 格式建议包含: {signals['structure']}")

        details = f"format={fmt}, hits={hit_count}/{total_kw}, signal_hits={hits[:5]}, score={score}"
        return {"score": score, "weight": SCORE_WEIGHTS["format_alignment"],
                "details": details, "issues": issues, "suggestions": suggestions}

    # ── 6. CTA Quality ─────────────────────────────────

    def _score_cta(self, script: dict) -> dict:
        cta = script.get("cta", "").strip()
        issues = []
        suggestions = []

        if not cta:
            return {"score": 0, "weight": SCORE_WEIGHTS["cta_quality"],
                    "details": "Missing CTA",
                    "issues": [{"type": "content", "severity": "major",
                                "message": "脚本缺少 CTA（行动号召）"}],
                    "suggestions": ["在结尾添加明确的 CTA，如 Follow / Like / Share"]}

        score = 100
        words = _word_count(cta)
        if words < 3:
            score -= 20
            issues.append({"type": "content", "severity": "minor",
                           "message": f"CTA 过短 ({words} 词)"})
        elif words > 20:
            score -= 10
            suggestions.append("CTA 建议简洁有力，15 词以内")

        cta_lower = cta.lower()
        action_hits = [v for v in CTA_ACTION_VERBS if v in cta_lower]
        if not action_hits:
            score -= 25
            issues.append({"type": "content", "severity": "minor",
                           "message": "CTA 缺少行动动词"})
            suggestions.append("CTA 中使用行动动词: follow, like, share, check, grab")

        platform_cta = {"follow", "like", "share", "comment", "save", "hit"}
        platform_hits = [v for v in platform_cta if v in cta_lower]
        if platform_hits:
            score = min(100, score + 5)

        details = f"{words}w, actions={action_hits[:3]}"
        return {"score": max(0, score), "weight": SCORE_WEIGHTS["cta_quality"],
                "details": details, "issues": issues, "suggestions": suggestions}

    # ── 7. Duration Fitness ────────────────────────────

    def _score_duration_fitness(self, script: dict) -> dict:
        duration = script.get("duration_seconds", 30)
        voiceover = script.get("voiceover_text", "")
        vds = script.get("visual_directions", [])
        issues = []
        suggestions = []
        score = 100

        vo_words = _word_count(voiceover)
        target_words = int(duration * 2.5)
        tolerance = 0.3

        if vo_words == 0:
            score -= 30
            issues.append({"type": "content", "severity": "major",
                           "message": "口播文案为空"})
        elif vo_words > target_words * (1 + tolerance):
            overshoot = (vo_words - target_words) / target_words
            penalty = min(30, int(overshoot * 50))
            score -= penalty
            issues.append({"type": "content", "severity": "warning",
                           "message": f"口播 {vo_words} 词超出 {duration}s 目标 ~{target_words} 词 ({overshoot:.0%})"})
            suggestions.append(f"精简口播到 ~{target_words} 词以匹配 {duration}s 时长")
        elif vo_words < target_words * (1 - tolerance):
            undershoot = (target_words - vo_words) / target_words
            penalty = min(20, int(undershoot * 40))
            score -= penalty
            issues.append({"type": "content", "severity": "minor",
                           "message": f"口播 {vo_words} 词偏少 ({duration}s 建议 ~{target_words} 词)"})

        if not vds:
            score -= 25
            issues.append({"type": "content", "severity": "major",
                           "message": "缺少 visual_directions"})
        elif len(vds) < 2:
            score -= 15
            issues.append({"type": "content", "severity": "minor",
                           "message": f"visual_directions 只有 {len(vds)} 个场景，建议至少 3 个"})
        else:
            last_vd = vds[-1]
            if isinstance(last_vd, dict):
                ts = last_vd.get("timestamp", "")
                end_match = re.search(r'(\d+)\s*s?$', ts)
                if end_match:
                    end_sec = int(end_match.group(1))
                    if end_sec < duration * 0.8:
                        score -= 10
                        issues.append({"type": "content", "severity": "minor",
                                       "message": f"视觉时间线在 {end_sec}s 结束，未覆盖 {duration}s 全时长"})

        details = f"vo={vo_words}w/target={target_words}w, scenes={len(vds)}, dur={duration}s"
        return {"score": max(0, score), "weight": SCORE_WEIGHTS["duration_fitness"],
                "details": details, "issues": issues, "suggestions": suggestions}

    # ── 8. Brief Alignment ─────────────────────────────

    def _score_brief_alignment(self, script: dict, brief: dict) -> dict:
        issues = []
        suggestions = []
        score = 100

        all_text = _extract_all_text(script).lower()

        key_messages = brief.get("key_messages", [])
        if key_messages:
            msg_hits = 0
            for msg in key_messages:
                msg_words = set(re.findall(r'\w{4,}', msg.lower()))
                if any(w in all_text for w in msg_words):
                    msg_hits += 1
            msg_ratio = msg_hits / len(key_messages)
            if msg_ratio < 0.5:
                penalty = int((1 - msg_ratio) * 30)
                score -= penalty
                issues.append({"type": "content", "severity": "warning",
                               "message": f"脚本仅覆盖 {msg_hits}/{len(key_messages)} 条 key_messages"})
                missed = [m for m in key_messages if not any(
                    w in all_text for w in set(re.findall(r'\w{4,}', m.lower())))]
                if missed:
                    suggestions.append(f"建议在脚本中融入: {', '.join(missed[:3])}")
        else:
            score -= 5

        brand_tone = brief.get("brand_tone", "").lower()
        if brand_tone:
            tone_words = set(re.findall(r'\w{4,}', brand_tone))
            tone_in_text = any(w in all_text for w in tone_words)
            if not tone_in_text and tone_words:
                score -= 10
                issues.append({"type": "content", "severity": "info",
                               "message": f"品牌 tone '{brand_tone}' 在脚本中未明确体现"})

        content_goal = brief.get("content_goal", "").replace("_", " ").lower()
        goal_keywords = {
            "brand awareness": ["brand", "know", "discover", "introducing", "meet", "new"],
            "product promotion": ["buy", "get", "grab", "shop", "order", "deal", "price", "sale"],
            "lead generation": ["sign up", "register", "link", "free", "download", "join"],
            "engagement": ["comment", "share", "tag", "challenge", "opinion", "what do you think"],
            "education": ["learn", "tip", "guide", "fact", "myth", "truth", "reason", "understand"],
        }
        goal_kws = goal_keywords.get(content_goal, [])
        if goal_kws:
            goal_hits = _text_contains_any(all_text, goal_kws)
            if not goal_hits:
                score -= 15
                issues.append({"type": "content", "severity": "minor",
                               "message": f"脚本未体现 content_goal '{content_goal}' 的典型语言信号"})
                suggestions.append(f"'{content_goal}' 目标建议使用: {', '.join(goal_kws[:4])}")

        platform = brief.get("platform", "tiktok")
        script_platform = script.get("platform", "")
        if script_platform and script_platform != platform:
            score -= 10
            issues.append({"type": "content", "severity": "warning",
                           "message": f"脚本平台 '{script_platform}' 与 Brief 平台 '{platform}' 不一致"})

        msg_detail = f"{len(key_messages)} msgs" if key_messages else "no msgs"
        details = f"goal={content_goal}, tone={brand_tone}, {msg_detail}"
        return {"score": max(0, score), "weight": SCORE_WEIGHTS["brief_alignment"],
                "details": details, "issues": issues, "suggestions": suggestions}

    # ── LLM Review (optional, default off) ──────────────

    def _blend_llm_scores(
        self, breakdown: dict, llm_result: dict,
        all_issues: list[dict], all_suggestions: list[str],
    ) -> None:
        """Blend LLM semantic scores into rule-based breakdown."""
        llm_angle = llm_result.get("angle_alignment_score")
        if llm_angle is not None and "angle_alignment" in breakdown:
            rule_score = breakdown["angle_alignment"].get("score", 60)
            blended = int(rule_score * 0.4 + llm_angle * 0.6)
            blended = min(100, max(0, blended))
            old_details = breakdown["angle_alignment"].get("details", "")
            breakdown["angle_alignment"]["score"] = blended
            breakdown["angle_alignment"]["details"] = (
                f"{old_details} | llm={llm_angle}, blended={blended}"
            )

        llm_content = llm_result.get("content_quality_score")
        llm_platform = llm_result.get("platform_fit_score")
        if llm_content is not None and llm_platform is not None:
            avg = int((llm_content + llm_platform) / 2)
            breakdown["llm_review"]["score"] = avg
            breakdown["llm_review"]["weight"] = 0.0

        llm_issues = llm_result.get("issues", [])
        for issue_text in llm_issues:
            if issue_text:
                all_issues.append({
                    "type": "llm_review", "severity": "info",
                    "message": f"[LLM] {issue_text}",
                })

        llm_suggestions = llm_result.get("suggestions", [])
        for sug in llm_suggestions:
            if sug:
                all_suggestions.append(f"[LLM] {sug}")

    async def _llm_review_content(self, script: dict, brief: dict, strategy: dict) -> dict:
        self.logger.info("qa.llm_review", script_id=script.get("script_id"))

        angle = script.get("topic_angle", "")
        topic = script.get("topic", "")
        fmt = script.get("topic_format", "")

        prompt = (
            "You are a professional short-form video script QA reviewer.\n"
            "Evaluate the following TikTok script against its creative brief.\n\n"
            f"## Script\n"
            f"- Title: {script.get('title', '')}\n"
            f"- Hook: {script.get('hook', '')}\n"
            f"- Body: {script.get('body', '')}\n"
            f"- CTA: {script.get('cta', '')}\n"
            f"- Voiceover: {script.get('voiceover_text', '')[:400]}\n\n"
            f"## Creative Brief\n"
            f"- Topic: {topic}\n"
            f"- Intended Angle: {angle}\n"
            f"- Format: {fmt}\n"
            f"- Content Goal: {brief.get('content_goal', '')}\n"
            f"- Brand Tone: {brief.get('brand_tone', '')}\n"
            f"- Platform: {brief.get('platform', 'tiktok')}\n"
            f"- Industry: {brief.get('client_industry', '')}\n\n"
            "## Evaluation Criteria\n"
            "Score each dimension from 0 to 100:\n"
            "1. angle_alignment_score: Does the script genuinely address the specific angle "
            f"'{angle[:100]}', not just the general topic?\n"
            "2. content_quality_score: Is the content engaging, well-structured, and valuable "
            "for the target audience?\n"
            "3. platform_fit_score: Does this feel native to TikTok? "
            "Would it stop someone from scrolling?\n\n"
            "## Output Format (strict JSON)\n"
            "Return ONLY valid JSON:\n"
            "{\n"
            '  "angle_alignment_score": 0-100,\n'
            '  "content_quality_score": 0-100,\n'
            '  "platform_fit_score": 0-100,\n'
            '  "summary": "One-sentence overall assessment",\n'
            '  "issues": ["Issue description if any, or empty array"],\n'
            '  "suggestions": ["Actionable improvement if any, or empty array"]\n'
            "}"
        )

        system_prompt = (
            "You are a senior content QA reviewer for short-form video production. "
            "Evaluate scripts objectively. Be specific in your assessment. "
            "Output ONLY valid JSON, no markdown or explanation."
        )

        try:
            result = await self.llm_client.complete_json(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.3,
            )
            parsed = result.get("parsed", {})
            parsed["_llm_model"] = result.get("model", "")
            parsed["_llm_tokens"] = result.get("usage", {}).get("total_tokens", 0)
            return parsed
        except Exception as e:
            self.logger.warning("qa.llm_review_failed", error=str(e))
            raise
