from typing import Any
from pipelines.base import BasePipeline, PipelineStep
from agents.video_production_agent import VideoProductionAgent
from services.video.generator import VideoProvider


class VideoGenerationPipeline(BasePipeline):
    """视频生成流水线: Script -> 视频生成 -> 结果收集"""
    name = "video_generation"

    def __init__(self, provider: VideoProvider = VideoProvider.MOCK, **provider_kwargs):
        super().__init__()
        self.video_agent = VideoProductionAgent(
            default_provider=provider,
            **provider_kwargs,
        )

    def define_steps(self) -> list[PipelineStep]:
        return [
            PipelineStep(name="validate_script", retryable=False),
            PipelineStep(name="generate_video", max_retries=2),
        ]

    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        if step_name == "validate_script":
            script = data.get("script")
            if not script:
                raise ValueError("Missing 'script'")
            if script.get("status") == "rejected":
                raise ValueError("Script has been rejected, cannot generate video")
            return {"script_validated": True}

        elif step_name == "generate_video":
            result = await self.video_agent.run({
                "script": data["script"],
                "video_params": data.get("video_params", {}),
            })
            if not result.success:
                raise RuntimeError(f"Video generation failed: {result.error}")
            return result.data

        raise ValueError(f"Unknown step: {step_name}")
