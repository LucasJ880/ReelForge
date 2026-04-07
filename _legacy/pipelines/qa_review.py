from typing import Any
from pipelines.base import BasePipeline, PipelineStep
from agents.qa_agent import QAAgent, AUTO_PASS_THRESHOLD


class QAReviewPipeline(BasePipeline):
    """质检审核流水线: Video + Script + Brief + Strategy -> 质检报告 -> 审核路由"""
    name = "qa_review"

    def __init__(self, llm_client=None):
        super().__init__()
        self.qa_agent = QAAgent(llm_client=llm_client)

    def define_steps(self) -> list[PipelineStep]:
        return [
            PipelineStep(name="run_qa_review"),
            PipelineStep(name="route_review", retryable=False),
        ]

    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        if step_name == "run_qa_review":
            result = await self.qa_agent.run({
                "video_job": data.get("video_job", {}),
                "script": data.get("script", {}),
                "brief": data.get("brief", {}),
                "strategy": data.get("strategy", {}),
                "enable_llm_review": data.get("enable_llm_review", False),
            })
            if not result.success:
                raise RuntimeError(f"QA review failed: {result.error}")
            return result.data

        elif step_name == "route_review":
            report = data.get("qa_report", {})
            score = report.get("overall_score", 0)
            has_critical = any(
                i.get("severity") == "critical"
                for i in report.get("issues", [])
            )

            if report.get("auto_pass") and not has_critical:
                report["human_review"] = {
                    "status": "auto_approved",
                    "notes": f"Score {score} >= {AUTO_PASS_THRESHOLD}, no critical issues",
                }
                return {"qa_report": report, "review_route": "auto_approved"}
            else:
                reasons = []
                if score < AUTO_PASS_THRESHOLD:
                    reasons.append(f"score {score} < {AUTO_PASS_THRESHOLD}")
                if has_critical:
                    reasons.append("has critical issues")
                report["human_review"] = {"status": "pending"}
                return {
                    "qa_report": report,
                    "review_route": "human_review_required",
                    "reason": " & ".join(reasons) if reasons else "manual review requested",
                }

        raise ValueError(f"Unknown step: {step_name}")
