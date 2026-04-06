from typing import Any
from pipelines.base import BasePipeline, PipelineStep
from agents.intake_agent import IntakeAgent


class ProjectIntakePipeline(BasePipeline):
    """项目录入流水线: 客户需求 -> 标准化 Brief"""
    name = "project_intake"

    def __init__(self, llm_client=None):
        super().__init__()
        self.intake_agent = IntakeAgent(llm_client=llm_client)

    def define_steps(self) -> list[PipelineStep]:
        return [
            PipelineStep(name="validate_input", retryable=False),
            PipelineStep(name="generate_brief"),
            PipelineStep(name="review_brief", retryable=False),
        ]

    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        if step_name == "validate_input":
            required = ["raw_requirements", "client_name"]
            missing = [k for k in required if not data.get(k)]
            if missing:
                raise ValueError(f"Missing required fields: {missing}")
            return {"input_validated": True}

        elif step_name == "generate_brief":
            result = await self.intake_agent.run(data)
            if not result.success:
                raise RuntimeError(f"Brief generation failed: {result.error}")
            return result.data

        elif step_name == "review_brief":
            brief = data.get("brief", {})
            brief["status"] = "draft"
            return {"brief": brief, "needs_human_review": True}

        raise ValueError(f"Unknown step: {step_name}")
