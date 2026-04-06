from agents.base import BaseAgent, AgentResult
from typing import Any
import uuid


class ResearchAgent(BaseAgent):
    name = "research_agent"
    description = "整理趋势、竞品数据、受众洞察，输出研究报告"

    def __init__(self, llm_client=None):
        super().__init__()
        self.llm_client = llm_client

    def validate_input(self, input_data: dict[str, Any]) -> None:
        required = ["brief"]
        missing = [k for k in required if k not in input_data]
        if missing:
            raise ValueError(f"缺少必要字段: {missing}")

    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        brief = input_data["brief"]
        platform = brief.get("platform", input_data.get("platform", "tiktok"))
        industry = brief.get("client_industry", input_data.get("industry", ""))

        raw_data = await self._gather_platform_data(platform, industry)

        if self.llm_client:
            report = await self._llm_analyze(brief, raw_data, platform, industry)
        else:
            report = self._fallback_report(brief, raw_data, platform, industry)

        return AgentResult(success=True, data={"research_report": report})

    async def _gather_platform_data(self, platform: str, industry: str) -> dict:
        """收集平台数据（当前为 mock，后续对接真实 API）"""
        self.logger.info("research.gather_data", platform=platform, industry=industry)
        return {
            "trending_hashtags": [
                f"#{platform}viral", f"#{industry}tips", "#trending2024",
                "#contentcreator", "#viralvideo",
            ],
            "avg_engagement_rate": 4.2,
            "top_content_formats": ["短剧", "教程", "产品展示", "幕后花絮", "用户评价"],
            "peak_posting_hours": [9, 12, 18, 21],
            "competitor_themes": ["教育型内容", "情感共鸣", "实用技巧", "产品对比"],
            "audience_demographics": {
                "age_range": "18-35",
                "primary_gender": "mixed",
                "interests": ["科技", "生活方式", "购物"],
            },
        }

    async def _llm_analyze(self, brief: dict, raw_data: dict, platform: str, industry: str) -> dict:
        """使用 LLM 分析趋势数据并生成研究报告"""
        self.logger.info("research.llm_analyze", platform=platform)
        prompt = (
            f"请基于以下数据为视频项目生成研究报告。\n\n"
            f"项目 Brief:\n客户: {brief.get('client_name')}\n"
            f"行业: {industry}\n平台: {platform}\n"
            f"目标: {brief.get('content_goal')}\n\n"
            f"平台数据:\n{raw_data}\n\n"
            f"请输出 JSON，包含: trending_topics(list), competitor_analysis(dict), "
            f"audience_insights(dict), platform_trends(dict), recommendations(list)"
        )
        try:
            result = await self.llm_client.complete_json(
                prompt=prompt,
                system_prompt="你是一个专业的短视频市场研究分析师。请输出 JSON 格式。",
            )
            report = result.get("parsed", {})
            report["report_id"] = uuid.uuid4().hex
            report["platform"] = platform
            report["industry"] = industry
            report["data_source"] = "llm_analysis"
            return report
        except Exception as e:
            self.logger.warning("research.llm_fallback", error=str(e))
            return self._fallback_report(brief, raw_data, platform, industry)

    def _fallback_report(self, brief: dict, raw_data: dict, platform: str, industry: str) -> dict:
        """不使用 LLM 时的回退方案"""
        return {
            "report_id": uuid.uuid4().hex,
            "platform": platform,
            "industry": industry,
            "data_source": "rule_based",
            "trending_topics": raw_data.get("trending_hashtags", [])[:5],
            "competitor_analysis": {
                "themes": raw_data.get("competitor_themes", []),
                "avg_engagement": raw_data.get("avg_engagement_rate", 0),
            },
            "audience_insights": raw_data.get("audience_demographics", {}),
            "platform_trends": {
                "top_formats": raw_data.get("top_content_formats", []),
                "peak_hours": raw_data.get("peak_posting_hours", []),
            },
            "recommendations": [
                f"聚焦 {platform} 平台热门内容形式",
                f"围绕 {industry} 行业核心痛点创作",
                "利用高峰时段发布以最大化曝光",
            ],
        }
