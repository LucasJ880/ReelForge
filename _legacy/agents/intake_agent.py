from agents.base import BaseAgent, AgentResult
from typing import Any
import uuid


class IntakeAgent(BaseAgent):
    name = "intake_agent"
    description = "接收客户需求，生成标准化项目 Brief"

    def __init__(self, llm_client=None):
        super().__init__()
        self.llm_client = llm_client

    def validate_input(self, input_data: dict[str, Any]) -> None:
        required = ["raw_requirements", "client_name", "platform"]
        missing = [k for k in required if k not in input_data]
        if missing:
            raise ValueError(f"缺少必要字段: {missing}")

    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        raw_req = input_data["raw_requirements"]
        client_name = input_data["client_name"]
        platform = input_data.get("platform", "tiktok")
        industry = input_data.get("client_industry", "")

        extracted = self._rule_extract(raw_req)

        if self.llm_client:
            brief = await self._llm_generate_brief(
                raw_req, client_name, platform, industry, extracted
            )
        else:
            brief = self._fallback_brief(raw_req, client_name, platform, industry)

        validation = self._rule_validate_brief(brief)
        if not validation["valid"]:
            brief["_warnings"] = validation["warnings"]

        return AgentResult(success=True, data={"brief": brief})

    def _rule_extract(self, raw_text: str) -> dict:
        """基于规则提取关键信息（不依赖LLM）"""
        info = {"has_deadline": False, "has_budget": False, "word_count": len(raw_text)}
        keywords_deadline = ["deadline", "截止", "交付日期", "due"]
        keywords_budget = ["budget", "预算", "价格", "费用"]
        text_lower = raw_text.lower()
        info["has_deadline"] = any(k in text_lower for k in keywords_deadline)
        info["has_budget"] = any(k in text_lower for k in keywords_budget)
        return info

    async def _llm_generate_brief(
        self, raw_req: str, client_name: str, platform: str, industry: str, extracted: dict
    ) -> dict:
        """调用 LLM 生成结构化 Brief"""
        self.logger.info("llm.generate_brief", client=client_name)
        prompt = (
            f"请根据以下客户需求生成一个标准化的视频项目 Brief（JSON 格式）。\n"
            f"客户: {client_name}\n行业: {industry}\n平台: {platform}\n"
            f"需求原文:\n{raw_req}\n\n"
            f"补充信息: {extracted}\n\n"
            f"Brief 必须包含以下字段: brief_id, client_name, client_industry, platform, "
            f"content_goal, raw_requirements, video_count, video_duration_seconds, language, status"
        )
        try:
            result = await self.llm_client.complete_json(
                prompt=prompt,
                system_prompt="你是一个专业的视频项目 Brief 生成器。请输出 JSON 格式。",
            )
            brief = result.get("parsed", {})
            brief.setdefault("brief_id", uuid.uuid4().hex)
            brief.setdefault("client_name", client_name)
            brief.setdefault("platform", platform)
            brief.setdefault("status", "draft")
            return brief
        except Exception as e:
            self.logger.warning("llm.fallback", error=str(e))
            return self._fallback_brief(raw_req, client_name, platform, industry)

    def _fallback_brief(self, raw_req: str, client_name: str, platform: str, industry: str) -> dict:
        """不使用 LLM 时的回退方案"""
        return {
            "brief_id": uuid.uuid4().hex,
            "client_name": client_name,
            "client_industry": industry,
            "platform": platform,
            "content_goal": "brand_awareness",
            "raw_requirements": raw_req,
            "video_count": 1,
            "video_duration_seconds": 30,
            "language": "en",
            "status": "draft",
        }

    def _rule_validate_brief(self, brief: dict) -> dict:
        """规则校验 Brief 完整性"""
        warnings = []
        if not brief.get("content_goal"):
            warnings.append("缺少内容目标")
        if not brief.get("video_count") or brief["video_count"] < 1:
            warnings.append("视频数量未指定")
        return {"valid": len(warnings) == 0, "warnings": warnings}
