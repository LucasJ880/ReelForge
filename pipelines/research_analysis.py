from typing import Any
from pipelines.base import BasePipeline, PipelineStep
from agents.research_agent import ResearchAgent


class ResearchAnalysisPipeline(BasePipeline):
    """研究分析流水线: Brief -> 数据采集+趋势分析 -> 研究报告"""
    name = "research_analysis"

    def __init__(self, llm_client=None):
        super().__init__()
        self.research_agent = ResearchAgent(llm_client=llm_client)

    def define_steps(self) -> list[PipelineStep]:
        return [
            PipelineStep(name="validate_brief", retryable=False),
            PipelineStep(name="run_research"),
        ]

    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        if step_name == "validate_brief":
            brief = data.get("brief")
            if not brief:
                raise ValueError("Missing 'brief' in input data")
            if not brief.get("client_name"):
                raise ValueError("Brief missing 'client_name'")
            return {"brief_validated": True}

        elif step_name == "run_research":
            result = await self.research_agent.run({
                "brief": data["brief"],
            })
            if not result.success:
                raise RuntimeError(f"Research failed: {result.error}")
            return result.data  # {"research_report": {...}}

        raise ValueError(f"Unknown step: {step_name}")
