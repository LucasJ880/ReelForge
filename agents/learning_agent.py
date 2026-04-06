from agents.base import BaseAgent, AgentResult
from typing import Any
import uuid


class LearningAgent(BaseAgent):
    name = "learning_agent"
    description = "后续表现数据沉淀与优化建议"

    def __init__(self, llm_client=None):
        super().__init__()
        self.llm_client = llm_client

    def validate_input(self, input_data: dict[str, Any]) -> None:
        required = ["delivery_records"]
        missing = [k for k in required if k not in input_data]
        if missing:
            raise ValueError(f"缺少必要字段: {missing}")

    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        delivery_records = input_data["delivery_records"]
        performance_data = input_data.get("performance_data", {})

        stats = self._compute_statistics(delivery_records, performance_data)

        if self.llm_client:
            report = await self._llm_generate_insights(stats, delivery_records, performance_data)
        else:
            report = self._fallback_report(stats, delivery_records, performance_data)

        return AgentResult(success=True, data={"learning_report": report})

    def _compute_statistics(self, records: list, performance: dict) -> dict:
        """基于规则计算统计数据"""
        total_videos = len(records)
        if total_videos == 0:
            return {"total_videos": 0, "avg_qa_score": 0, "delivery_rate": 0}

        qa_scores = [r.get("qa_score", 0) for r in records if r.get("qa_score")]
        avg_qa = sum(qa_scores) / len(qa_scores) if qa_scores else 0

        delivered = sum(1 for r in records if r.get("status") == "delivered")
        delivery_rate = delivered / total_videos if total_videos > 0 else 0

        providers = {}
        for r in records:
            provider = r.get("metadata", {}).get("provider", "unknown")
            providers[provider] = providers.get(provider, 0) + 1

        views = performance.get("total_views", 0)
        likes = performance.get("total_likes", 0)
        engagement = likes / views if views > 0 else 0

        return {
            "total_videos": total_videos,
            "delivered_count": delivered,
            "delivery_rate": round(delivery_rate, 2),
            "avg_qa_score": round(avg_qa, 1),
            "provider_distribution": providers,
            "engagement_rate": round(engagement, 4),
            "total_views": views,
            "total_likes": likes,
        }

    async def _llm_generate_insights(self, stats: dict, records: list, performance: dict) -> dict:
        """使用 LLM 分析表现数据，生成优化建议"""
        self.logger.info("learning.llm_analyze", total_videos=stats["total_videos"])
        prompt = (
            f"请基于以下视频项目数据生成学习报告和优化建议。\n\n"
            f"统计数据:\n{stats}\n\n"
            f"表现数据:\n{performance}\n\n"
            f"交付记录数: {len(records)}\n\n"
            f"请输出 JSON，包含:\n"
            f"- insights (list[str]): 关键洞察\n"
            f"- optimization_suggestions (list[dict]): 优化建议，每项含 area, suggestion, priority\n"
            f"- cost_analysis (dict): 成本分析\n"
            f"- quality_trends (dict): 质量趋势"
        )
        try:
            result = await self.llm_client.complete_json(
                prompt=prompt,
                system_prompt="你是一个数据驱动的视频内容优化专家。请输出 JSON 格式。",
            )
            report = result.get("parsed", {})
            report["report_id"] = uuid.uuid4().hex
            report["statistics"] = stats
            return report
        except Exception as e:
            self.logger.warning("learning.llm_fallback", error=str(e))
            return self._fallback_report(stats, records, performance)

    def _fallback_report(self, stats: dict, records: list, performance: dict) -> dict:
        """不使用 LLM 时的回退方案"""
        insights = []
        suggestions = []

        if stats["avg_qa_score"] < 70:
            insights.append("平均 QA 分数偏低，内容质量需要提升")
            suggestions.append({
                "area": "content_quality",
                "suggestion": "加强脚本审核环节，提高内容质量基线",
                "priority": "high",
            })

        if stats["delivery_rate"] < 0.8:
            insights.append(f"交付率 {stats['delivery_rate']*100:.0f}% 低于 80% 目标")
            suggestions.append({
                "area": "production_pipeline",
                "suggestion": "优化视频生成和 QA 流程，减少返工",
                "priority": "high",
            })

        if stats["engagement_rate"] > 0:
            if stats["engagement_rate"] < 0.02:
                insights.append("互动率低于 2%，需要优化内容吸引力")
                suggestions.append({
                    "area": "content_strategy",
                    "suggestion": "强化 Hook 和 CTA 设计，提升互动率",
                    "priority": "medium",
                })
            elif stats["engagement_rate"] > 0.05:
                insights.append("互动率表现优异，保持当前策略")

        if not insights:
            insights.append("数据量不足，建议积累更多项目数据后再分析")

        if not suggestions:
            suggestions.append({
                "area": "general",
                "suggestion": "继续保持当前工作流程，关注长期数据趋势",
                "priority": "low",
            })

        return {
            "report_id": uuid.uuid4().hex,
            "statistics": stats,
            "insights": insights,
            "optimization_suggestions": suggestions,
            "cost_analysis": {
                "total_videos": stats["total_videos"],
                "avg_cost_estimate": "N/A（需要接入成本追踪）",
            },
            "quality_trends": {
                "avg_qa_score": stats["avg_qa_score"],
                "trend": "stable" if stats["avg_qa_score"] >= 70 else "needs_improvement",
            },
        }
