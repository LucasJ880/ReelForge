from typing import Any
from pipelines.base import BasePipeline, PipelineStep
from agents.learning_agent import LearningAgent


class FeedbackLoopPipeline(BasePipeline):
    """反馈循环流水线: 交付数据 -> 表现追踪 -> 分析 -> 优化建议"""
    name = "feedback_loop"

    def __init__(self, llm_client=None):
        super().__init__()
        self.learning_agent = LearningAgent(llm_client=llm_client)

    def define_steps(self) -> list[PipelineStep]:
        return [
            PipelineStep(name="collect_performance"),
            PipelineStep(name="analyze_results"),
            PipelineStep(name="generate_insights", retryable=False),
        ]

    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        if step_name == "collect_performance":
            delivery_record = data.get("delivery_record", {})
            project_id = data.get("project_id", "")

            result = await self.learning_agent.run({
                "action": "collect",
                "delivery_record": delivery_record,
                "project_id": project_id,
            })
            if not result.success:
                raise RuntimeError(f"Performance data collection failed: {result.error}")

            return {"performance_data": result.data.get("performance_data", {})}

        elif step_name == "analyze_results":
            result = await self.learning_agent.run({
                "action": "analyze",
                "performance_data": data.get("performance_data", {}),
                "brief": data.get("brief", {}),
                "strategy": data.get("strategy", {}),
                "scripts": data.get("scripts", []),
            })
            if not result.success:
                raise RuntimeError(f"Results analysis failed: {result.error}")

            return {"analysis": result.data}

        elif step_name == "generate_insights":
            analysis = data.get("analysis", {})
            performance = data.get("performance_data", {})

            insights = {
                "top_performing_content": analysis.get("top_content", []),
                "underperforming_content": analysis.get("low_content", []),
                "audience_response_patterns": analysis.get("patterns", {}),
                "optimization_suggestions": analysis.get("suggestions", []),
                "recommended_adjustments": {
                    "content_strategy": analysis.get("strategy_adjustments", []),
                    "script_style": analysis.get("script_adjustments", []),
                    "posting_schedule": analysis.get("schedule_adjustments", []),
                },
                "metrics_summary": {
                    "avg_engagement_rate": performance.get("engagement_rate", 0),
                    "total_views": performance.get("views", 0),
                    "avg_watch_time": performance.get("watch_time_seconds", 0),
                },
            }
            return {"insights": insights, "feedback_complete": True}

        raise ValueError(f"Unknown step: {step_name}")
