from abc import ABC, abstractmethod
from typing import Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import structlog
import uuid

logger = structlog.get_logger()


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class PipelineStep:
    name: str
    status: StepStatus = StepStatus.PENDING
    input_data: dict = field(default_factory=dict)
    output_data: dict = field(default_factory=dict)
    error: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    retryable: bool = True
    max_retries: int = 2
    retry_count: int = 0


@dataclass
class PipelineResult:
    pipeline_name: str
    run_id: str
    status: str  # completed, failed, partial
    steps: list[PipelineStep] = field(default_factory=list)
    final_output: dict = field(default_factory=dict)
    started_at: str = ""
    completed_at: str = ""


class BasePipeline(ABC):
    name: str = "base_pipeline"

    def __init__(self):
        self.logger = logger.bind(pipeline=self.name)
        self.steps: list[PipelineStep] = []

    async def run(self, input_data: dict[str, Any]) -> PipelineResult:
        run_id = uuid.uuid4().hex
        self.logger.info("pipeline.start", run_id=run_id)
        started = datetime.utcnow().isoformat()

        self.steps = self.define_steps()
        current_data = input_data.copy()

        for step in self.steps:
            step.status = StepStatus.RUNNING
            step.started_at = datetime.utcnow().isoformat()
            step.input_data = current_data

            try:
                output = await self.execute_step(step.name, current_data)
                step.output_data = output
                step.status = StepStatus.COMPLETED
                step.completed_at = datetime.utcnow().isoformat()
                current_data.update(output)
                self.logger.info("pipeline.step.complete", step=step.name)
            except Exception as e:
                step.error = str(e)
                step.status = StepStatus.FAILED
                self.logger.error("pipeline.step.failed", step=step.name, error=str(e))

                if step.retryable and step.retry_count < step.max_retries:
                    step.retry_count += 1
                    self.logger.info("pipeline.step.retry", step=step.name, attempt=step.retry_count)
                    try:
                        output = await self.execute_step(step.name, current_data)
                        step.output_data = output
                        step.status = StepStatus.COMPLETED
                        current_data.update(output)
                        continue
                    except Exception:
                        pass

                return PipelineResult(
                    pipeline_name=self.name, run_id=run_id, status="failed",
                    steps=self.steps, final_output=current_data,
                    started_at=started, completed_at=datetime.utcnow().isoformat(),
                )

        return PipelineResult(
            pipeline_name=self.name, run_id=run_id, status="completed",
            steps=self.steps, final_output=current_data,
            started_at=started, completed_at=datetime.utcnow().isoformat(),
        )

    @abstractmethod
    def define_steps(self) -> list[PipelineStep]:
        ...

    @abstractmethod
    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        ...
