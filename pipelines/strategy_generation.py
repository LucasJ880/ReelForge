from typing import Any
from pipelines.base import BasePipeline, PipelineStep
from agents.strategy_agent import StrategyAgent


class StrategyGenerationPipeline(BasePipeline):
    """策略生成流水线: Brief + Research -> 内容策略"""
    name = "strategy_generation"

    def __init__(self, llm_client=None):
        super().__init__()
        self.strategy_agent = StrategyAgent(llm_client=llm_client)

    def define_steps(self) -> list[PipelineStep]:
        return [
            PipelineStep(name="validate_inputs", retryable=False),
            PipelineStep(name="generate_strategy"),
        ]

    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        if step_name == "validate_inputs":
            if not data.get("brief"):
                raise ValueError("Missing 'brief'")
            if not data.get("research_report"):
                raise ValueError("Missing 'research_report'")
            return {"inputs_validated": True}

        elif step_name == "generate_strategy":
            result = await self.strategy_agent.run({
                "brief": data["brief"],
                "research_report": data["research_report"],
            })
            if not result.success:
                raise RuntimeError(f"Strategy generation failed: {result.error}")
            return result.data  # {"strategy": {...}}

        raise ValueError(f"Unknown step: {step_name}")
