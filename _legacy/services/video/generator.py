"""
Video Generation Provider 抽象层
================================
定义了统一的视频生成接口，所有 provider（mock、seedance、runway 等）
都必须实现 BaseVideoGenerator 接口。

架构：
    BaseVideoGenerator (ABC)
    ├── MockVideoGenerator      — 开发/测试用，模拟真实行为
    ├── SeedanceVideoGenerator   — 火山方舟 Ark Seedance（真实接入）
    └── (future providers)

使用方式：
    generator = create_video_generator(VideoProvider.MOCK)
    result = await generator.generate(request)

    generator = create_video_generator(
        VideoProvider.SEEDANCE,
        api_key=os.environ["ARK_API_KEY"],
    )
    result = await generator.generate(request)
"""

from abc import ABC, abstractmethod
from typing import Any
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime, timezone
import structlog
import uuid
import asyncio

logger = structlog.get_logger()


class VideoProvider(str, Enum):
    MOCK = "mock"
    SEEDANCE = "seedance"
    RUNWAY = "runway"
    PIKA = "pika"


PROVIDER_PRICING = {
    VideoProvider.MOCK: {"cost_per_second_cents": 0, "base_cost_cents": 0},
    VideoProvider.SEEDANCE: {"cost_per_second_cents": 2, "base_cost_cents": 0},
    VideoProvider.RUNWAY: {"cost_per_second_cents": 10, "base_cost_cents": 100},
    VideoProvider.PIKA: {"cost_per_second_cents": 5, "base_cost_cents": 30},
}


@dataclass
class VideoGenerationRequest:
    script_id: str
    prompt: str
    duration_seconds: int = 30
    aspect_ratio: str = "9:16"
    style: str = "default"
    provider: VideoProvider = VideoProvider.MOCK
    model: str = ""
    extra_params: dict = field(default_factory=dict)


@dataclass
class VideoGenerationResult:
    job_id: str
    status: str
    provider: str
    output_url: str | None = None
    error: str | None = None
    metadata: dict = field(default_factory=dict)
    model: str = ""
    cost_cents: int = 0
    duration_seconds: int = 0
    started_at: str = ""
    completed_at: str = ""
    attempt_count: int = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _estimate_cost(provider: VideoProvider, duration_seconds: int) -> int:
    pricing = PROVIDER_PRICING.get(provider, PROVIDER_PRICING[VideoProvider.MOCK])
    return pricing["base_cost_cents"] + pricing["cost_per_second_cents"] * duration_seconds


# ── Abstract Base ────────────────────────────────────────

class BaseVideoGenerator(ABC):
    """所有视频生成 provider 必须实现此接口"""

    provider: VideoProvider

    @abstractmethod
    async def generate(self, request: VideoGenerationRequest) -> VideoGenerationResult:
        """提交视频生成请求，返回初始结果（可能是 pending/processing/completed）"""
        ...

    @abstractmethod
    async def check_status(self, job_id: str) -> VideoGenerationResult:
        """查询已提交任务的当前状态"""
        ...

    def estimate_cost(self, duration_seconds: int) -> int:
        """估算生成成本（美分）"""
        return _estimate_cost(self.provider, duration_seconds)


# ── Mock Provider ────────────────────────────────────────

class MockVideoGenerator(BaseVideoGenerator):
    """
    开发/测试用 Mock Provider
    模拟真实 provider 的行为：生成 job_id、填充 metadata、估算耗时/成本。
    """

    provider = VideoProvider.MOCK

    async def generate(self, request: VideoGenerationRequest) -> VideoGenerationResult:
        job_id = uuid.uuid4().hex
        started = _now_iso()

        logger.info("mock_video.generate", job_id=job_id, duration=request.duration_seconds)

        simulated_processing_ms = min(request.duration_seconds * 100, 3000)
        await asyncio.sleep(simulated_processing_ms / 1000)

        completed = _now_iso()
        cost = self.estimate_cost(request.duration_seconds)

        return VideoGenerationResult(
            job_id=job_id,
            status="completed",
            provider=self.provider.value,
            model="mock-v1",
            output_url=f"file://storage/mock/{job_id}.mp4",
            cost_cents=cost,
            duration_seconds=request.duration_seconds,
            started_at=started,
            completed_at=completed,
            attempt_count=1,
            metadata={
                "duration": request.duration_seconds,
                "resolution": "1080x1920",
                "aspect_ratio": request.aspect_ratio,
                "format": "mp4",
                "file_size_bytes": request.duration_seconds * 2_000_000,
                "style": request.style,
                "prompt_length": len(request.prompt),
            },
        )

    async def check_status(self, job_id: str) -> VideoGenerationResult:
        return VideoGenerationResult(
            job_id=job_id,
            status="completed",
            provider=self.provider.value,
            model="mock-v1",
            output_url=f"file://storage/mock/{job_id}.mp4",
        )


# ── Seedance Provider (火山方舟 Ark) ─────────────────────

_ARK_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
_ARK_DEFAULT_MODEL = "doubao-seedance-1-5-pro-251215"

_ARK_STATUS_MAP = {
    "queued": "processing",
    "running": "processing",
    "succeeded": "completed",
    "failed": "failed",
    "expired": "failed",
}


class SeedanceVideoGenerator(BaseVideoGenerator):
    """
    火山方舟 Ark — Seedance 视频生成 Provider

    API 流程 (异步):
        1. POST /contents/generations/tasks  → 返回 {"id": task_id}
        2. GET  /contents/generations/tasks/{id} → 轮询 status
        3. status=succeeded 时 content.video_url 包含 CDN 视频地址

    支持模型:
        - doubao-seedance-1-5-pro-251215  (默认，支持音频)
        - doubao-seedance-1-0-pro-250428
        - doubao-seedance-1-0-pro-fast-250528
        - doubao-seedance-1-0-lite-t2v-250219

    限制:
        - 时长: 4-12 秒
        - 分辨率: 480p / 720p / 1080p
        - 视频 URL 24 小时过期
    """

    provider = VideoProvider.SEEDANCE
    SUPPORTED_DURATIONS = [4, 5, 8, 12]
    SUPPORTED_RESOLUTIONS = ("480p", "720p", "1080p")

    def __init__(
        self,
        api_key: str = "",
        base_url: str = "",
        model: str = "",
        resolution: str = "720p",
    ):
        self.api_key = api_key
        self.base_url = (base_url or _ARK_DEFAULT_BASE_URL).rstrip("/")
        self.model = model or _ARK_DEFAULT_MODEL
        self.resolution = resolution if resolution in self.SUPPORTED_RESOLUTIONS else "720p"
        if not self.api_key:
            raise ValueError(
                "ARK_API_KEY is required. "
                "获取方式: https://console.volcengine.com/ → 火山方舟 → API Key 管理"
            )

    def _pick_duration(self, requested: int) -> int:
        for d in self.SUPPORTED_DURATIONS:
            if requested <= d:
                return d
        return self.SUPPORTED_DURATIONS[-1]

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def generate(self, request: VideoGenerationRequest) -> VideoGenerationResult:
        import httpx

        started = _now_iso()
        actual_duration = self._pick_duration(request.duration_seconds)

        if actual_duration != request.duration_seconds:
            logger.info(
                "seedance.duration_mapped",
                requested=request.duration_seconds,
                actual=actual_duration,
            )

        ark_ratio = request.aspect_ratio.replace(":", ":")
        payload: dict[str, Any] = {
            "model": self.model,
            "content": [
                {"type": "text", "text": request.prompt[:2000]},
            ],
            "ratio": ark_ratio,
            "duration": actual_duration,
            "resolution": self.resolution,
        }

        logger.info(
            "seedance.generate",
            model=self.model,
            duration=actual_duration,
            resolution=self.resolution,
            ratio=ark_ratio,
            prompt_len=len(request.prompt),
        )

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{self.base_url}/contents/generations/tasks",
                    json=payload,
                    headers=self._headers(),
                )

            if resp.status_code == 401:
                return VideoGenerationResult(
                    job_id="",
                    status="failed",
                    provider=self.provider.value,
                    model=self.model,
                    error="ARK_API_KEY 无效或已过期 (HTTP 401)",
                    started_at=started,
                )

            resp.raise_for_status()
            body = resp.json()

        except httpx.HTTPStatusError as e:
            err_text = ""
            try:
                err_text = e.response.text[:500]
            except Exception:
                pass
            return VideoGenerationResult(
                job_id="",
                status="failed",
                provider=self.provider.value,
                model=self.model,
                error=f"Ark HTTP {e.response.status_code}: {err_text}",
                started_at=started,
            )
        except httpx.RequestError as e:
            return VideoGenerationResult(
                job_id="",
                status="failed",
                provider=self.provider.value,
                model=self.model,
                error=f"Ark 网络错误: {type(e).__name__}: {e}",
                started_at=started,
            )

        task_id = body.get("id", "")
        if not task_id:
            return VideoGenerationResult(
                job_id="",
                status="failed",
                provider=self.provider.value,
                model=self.model,
                error=f"Ark 未返回 task id: {body}",
                started_at=started,
            )

        ark_status = body.get("status", "queued")
        our_status = _ARK_STATUS_MAP.get(ark_status, "processing")

        logger.info("seedance.task_created", task_id=task_id, ark_status=ark_status)

        return VideoGenerationResult(
            job_id=task_id,
            status=our_status,
            provider=self.provider.value,
            model=self.model,
            started_at=started,
            duration_seconds=actual_duration,
            cost_cents=self.estimate_cost(actual_duration),
            metadata={
                "requested_duration": request.duration_seconds,
                "actual_duration": actual_duration,
                "resolution": self.resolution,
                "ratio": ark_ratio,
            },
        )

    async def check_status(self, job_id: str) -> VideoGenerationResult:
        import httpx

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{self.base_url}/contents/generations/tasks/{job_id}",
                    headers=self._headers(),
                )

            resp.raise_for_status()
            body = resp.json()

        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            logger.warning("seedance.poll_error", job_id=job_id, error=str(e))
            return VideoGenerationResult(
                job_id=job_id,
                status="processing",
                provider=self.provider.value,
                model=self.model,
                error=f"Poll error: {e}",
            )

        ark_status = body.get("status", "running")
        our_status = _ARK_STATUS_MAP.get(ark_status, "processing")
        content = body.get("content", {}) or {}
        error_obj = body.get("error", {}) or {}

        if our_status == "completed":
            video_url = content.get("video_url")

            logger.info(
                "seedance.completed",
                job_id=job_id,
                has_url=bool(video_url),
            )

            return VideoGenerationResult(
                job_id=job_id,
                status="completed",
                provider=self.provider.value,
                model=self.model,
                output_url=video_url,
                cost_cents=self.estimate_cost(
                    body.get("duration", 0) or self.SUPPORTED_DURATIONS[-1]
                ),
                duration_seconds=body.get("duration", 0),
                completed_at=_now_iso(),
                metadata={
                    "resolution": body.get("resolution", self.resolution),
                    "ratio": body.get("ratio", ""),
                    "duration": body.get("duration", 0),
                    "format": "mp4",
                    "video_url_expires": "24h",
                },
            )

        elif our_status == "failed":
            err_msg = error_obj.get("message") or f"Ark task {ark_status}"
            logger.warning("seedance.failed", job_id=job_id, error=err_msg)
            return VideoGenerationResult(
                job_id=job_id,
                status="failed",
                provider=self.provider.value,
                model=self.model,
                error=err_msg,
            )

        else:
            logger.debug("seedance.polling", job_id=job_id, ark_status=ark_status)
            return VideoGenerationResult(
                job_id=job_id,
                status="processing",
                provider=self.provider.value,
                model=self.model,
            )


# ── Factory ──────────────────────────────────────────────

def create_video_generator(
    provider: VideoProvider = VideoProvider.MOCK,
    **kwargs,
) -> BaseVideoGenerator:
    """
    创建视频生成器实例。

    Args:
        provider: 选择哪个 provider
        **kwargs: 传递给 provider 构造函数的参数（如 api_key）

    Returns:
        BaseVideoGenerator 实例
    """
    generators: dict[VideoProvider, type[BaseVideoGenerator]] = {
        VideoProvider.MOCK: MockVideoGenerator,
        VideoProvider.SEEDANCE: SeedanceVideoGenerator,
    }
    gen_class = generators.get(provider)
    if not gen_class:
        raise ValueError(
            f"Unsupported video provider: {provider}. "
            f"Available: {list(generators.keys())}"
        )
    return gen_class(**kwargs) if kwargs else gen_class()
