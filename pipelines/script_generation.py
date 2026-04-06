from typing import Any
from pipelines.base import BasePipeline, PipelineStep
from agents.script_agent import ScriptAgent


class ScriptGenerationPipeline(BasePipeline):
    """脚本生成流水线: Brief + Strategy -> 选题 -> 脚本生成 -> 校验"""
    name = "script_generation"

    def __init__(self, llm_client=None):
        super().__init__()
        self.script_agent = ScriptAgent(llm_client=llm_client)

    def define_steps(self) -> list[PipelineStep]:
        return [
            PipelineStep(name="select_topic", retryable=False),
            PipelineStep(name="generate_script"),
            PipelineStep(name="validate_script", retryable=False),
        ]

    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        if step_name == "select_topic":
            strategy = data.get("strategy", {})
            topics = strategy.get("topic_suggestions", [])

            if not topics:
                topic_item = {
                    "topic": "产品亮点速览",
                    "format": "showcase",
                    "angle": "60-second product tour",
                    "duration": 30,
                    "priority": "high",
                }
            else:
                raw = topics[0]
                if isinstance(raw, dict):
                    topic_item = {
                        "topic": raw.get("topic", ""),
                        "format": raw.get("format", ""),
                        "angle": raw.get("angle", ""),
                        "duration": raw.get("duration", 30),
                        "priority": raw.get("priority", "medium"),
                    }
                else:
                    topic_item = {
                        "topic": str(raw),
                        "format": "",
                        "angle": "",
                        "duration": 30,
                        "priority": "medium",
                    }

            return {"topic_item": topic_item}

        elif step_name == "generate_script":
            result = await self.script_agent.run({
                "brief": data.get("brief", {}),
                "strategy": data.get("strategy", {}),
                "topic_item": data["topic_item"],
            })
            if not result.success:
                raise RuntimeError(f"Script generation failed: {result.error}")
            return result.data

        elif step_name == "validate_script":
            script = data.get("script", {})
            issues = []

            if not script.get("title"):
                issues.append("Missing title")
            if not script.get("hook"):
                issues.append("Missing hook")
            if not script.get("voiceover_text"):
                issues.append("Missing voiceover_text")
            if not script.get("cta"):
                issues.append("Missing CTA")

            vds = script.get("visual_directions", [])
            if not vds:
                issues.append("Missing visual_directions")
            elif len(vds) < 2:
                issues.append(f"visual_directions too few ({len(vds)}, need >= 2)")

            script["validation_issues"] = issues
            script["status"] = "validated" if not issues else "needs_review"
            return {"script": script}

        raise ValueError(f"Unknown step: {step_name}")
