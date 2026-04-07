from agents.base import BaseAgent, AgentResult
from typing import Any
from services.video.generator import (
    VideoProvider,
    VideoGenerationRequest,
    VideoGenerationResult,
    create_video_generator,
    _now_iso,
    _estimate_cost,
)
import asyncio
import time

MAX_POLL_ATTEMPTS = 30
POLL_INTERVAL_SECONDS = 10
MAX_RETRIES = 2

VALID_STATUS_TRANSITIONS = {
    "pending":    {"processing", "completed", "failed", "cancelled"},
    "processing": {"completed", "failed", "timeout", "cancelled"},
    "retrying":   {"processing", "completed", "failed"},
    "completed":  set(),
    "failed":     {"retrying"},
    "timeout":    {"retrying"},
    "cancelled":  set(),
}


class VideoProductionAgent(BaseAgent):
    name = "video_production_agent"
    description = "视频生成任务调度，选择 provider 并管理生成流程"
    version = "0.4.0"

    def __init__(self, default_provider: VideoProvider = VideoProvider.MOCK, **provider_kwargs):
        super().__init__()
        self.default_provider = default_provider
        self.provider_kwargs = provider_kwargs

    def validate_input(self, input_data: dict[str, Any]) -> None:
        required = ["script"]
        missing = [k for k in required if k not in input_data]
        if missing:
            raise ValueError(f"缺少必要字段: {missing}")

    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        script = input_data["script"]
        video_params = input_data.get("video_params", {})

        provider = self._select_provider(video_params)
        generator = create_video_generator(provider, **self.provider_kwargs)
        request = self._build_request(script, video_params, provider)

        estimated_cost = _estimate_cost(provider, request.duration_seconds)
        started_at = _now_iso()
        t0 = time.monotonic()

        result, attempt_count = await self._generate_with_retry(generator, request)

        if result.status not in ("completed", "failed"):
            result = await self._poll_status(generator, result.job_id)

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        completed_at = _now_iso()

        video_job = self._build_video_job(
            result=result,
            script=script,
            request=request,
            provider=provider,
            estimated_cost=estimated_cost,
            started_at=started_at,
            completed_at=completed_at,
            processing_time_ms=elapsed_ms,
            attempt_count=attempt_count,
        )

        success = result.status == "completed"
        return AgentResult(
            success=success,
            data={"video_job": video_job},
            error=result.error if not success else None,
            metadata={
                "provider": provider.value,
                "status": result.status,
                "cost_cents": video_job["cost_cents"],
                "processing_time_ms": elapsed_ms,
            },
        )

    def _build_video_job(
        self,
        result: VideoGenerationResult,
        script: dict,
        request: VideoGenerationRequest,
        provider: VideoProvider,
        estimated_cost: int,
        started_at: str,
        completed_at: str,
        processing_time_ms: int,
        attempt_count: int,
    ) -> dict:
        return {
            "job_id": result.job_id,
            "script_id": script.get("script_id", ""),
            "provider": result.provider,
            "model": result.model or f"{provider.value}-default",
            "status": result.status,
            "output_url": result.output_url,
            "error_message": result.error,
            "input_params": {
                "prompt": request.prompt[:200] + "..." if len(request.prompt) > 200 else request.prompt,
                "duration_seconds": request.duration_seconds,
                "aspect_ratio": request.aspect_ratio,
                "style": request.style,
            },
            "output_metadata": result.metadata,
            "duration_requested": request.duration_seconds,
            "aspect_ratio": request.aspect_ratio,
            "retry_count": max(0, attempt_count - 1),
            "max_retries": MAX_RETRIES,
            "attempt_count": attempt_count,
            "cost_cents": result.cost_cents,
            "estimated_cost_cents": estimated_cost,
            "started_at": started_at,
            "completed_at": completed_at if result.status in ("completed", "failed", "timeout") else None,
            "processing_time_ms": processing_time_ms,
            "agent_version": self.version,
        }

    def _select_provider(self, video_params: dict) -> VideoProvider:
        provider_name = video_params.get("provider")
        if provider_name:
            try:
                return VideoProvider(provider_name)
            except ValueError:
                self.logger.warning("production.unknown_provider", provider=provider_name)
        return self.default_provider

    def _build_request(
        self, script: dict, video_params: dict, provider: VideoProvider
    ) -> VideoGenerationRequest:
        prompt_parts = []
        if script.get("visual_directions"):
            for d in script["visual_directions"]:
                if isinstance(d, dict):
                    prompt_parts.append(f"[{d.get('timestamp', '')}] {d.get('description', '')}")
                else:
                    prompt_parts.append(str(d))
        prompt = "\n".join(prompt_parts) if prompt_parts else script.get("body", "")

        return VideoGenerationRequest(
            script_id=script.get("script_id", "unknown"),
            prompt=prompt,
            duration_seconds=script.get("duration_seconds", 30),
            aspect_ratio=video_params.get("aspect_ratio", "9:16"),
            style=video_params.get("style", "default"),
            provider=provider,
            model=video_params.get("model", ""),
            extra_params=video_params.get("extra", {}),
        )

    async def _generate_with_retry(
        self, generator, request: VideoGenerationRequest
    ) -> tuple[VideoGenerationResult, int]:
        """返回 (result, attempt_count)"""
        last_error = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                self.logger.info(
                    "production.generate",
                    attempt=attempt + 1,
                    provider=request.provider.value,
                )
                result = await generator.generate(request)
                if result.status != "failed":
                    result.attempt_count = attempt + 1
                    return result, attempt + 1
                last_error = result.error
            except Exception as e:
                last_error = str(e)
                self.logger.warning(
                    "production.retry",
                    attempt=attempt + 1,
                    error=last_error,
                )
            if attempt < MAX_RETRIES:
                await asyncio.sleep(2 ** attempt)

        return VideoGenerationResult(
            job_id="failed_" + request.script_id[:8],
            status="failed",
            provider=request.provider.value,
            error=f"生成失败（已重试 {MAX_RETRIES} 次）: {last_error}",
            attempt_count=MAX_RETRIES + 1,
        ), MAX_RETRIES + 1

    async def _poll_status(self, generator, job_id: str) -> VideoGenerationResult:
        for i in range(MAX_POLL_ATTEMPTS):
            self.logger.info("production.poll", job_id=job_id, attempt=i + 1)
            result = await generator.check_status(job_id)
            if result.status in ("completed", "failed"):
                return result
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

        return VideoGenerationResult(
            job_id=job_id,
            status="timeout",
            provider="unknown",
            error=f"任务超时（已轮询 {MAX_POLL_ATTEMPTS} 次）",
        )
