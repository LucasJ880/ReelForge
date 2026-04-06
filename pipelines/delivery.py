import uuid
from typing import Any
from datetime import datetime
from pipelines.base import BasePipeline, PipelineStep
from agents.delivery_agent import DeliveryAgent


class DeliveryPipeline(BasePipeline):
    """交付流水线: QA通过 -> 准备交付 -> 生成记录 -> 交付"""
    name = "delivery"

    def __init__(self, llm_client=None):
        super().__init__()
        self.delivery_agent = DeliveryAgent(llm_client=llm_client)

    def define_steps(self) -> list[PipelineStep]:
        return [
            PipelineStep(name="prepare_assets", retryable=False),
            PipelineStep(name="create_delivery_record", retryable=False),
            PipelineStep(name="deliver"),
        ]

    async def execute_step(self, step_name: str, data: dict[str, Any]) -> dict[str, Any]:
        if step_name == "prepare_assets":
            video_job = data.get("video_job", {})
            qa_report = data.get("qa_report", {})

            if not qa_report.get("auto_pass") and qa_report.get("human_review", {}).get("status") != "approved":
                raise ValueError("Cannot deliver: QA review not passed")

            output_url = video_job.get("output_url", "")
            if not output_url:
                raise ValueError("No video output URL available")

            delivery_format = data.get("delivery_format", "mp4")
            result = await self.delivery_agent.run({
                "action": "prepare",
                "video_url": output_url,
                "format": delivery_format,
                "project_id": data.get("project_id", ""),
            })
            if not result.success:
                raise RuntimeError(f"Asset preparation failed: {result.error}")

            return {
                "prepared_url": result.data.get("url", output_url),
                "delivery_format": delivery_format,
            }

        elif step_name == "create_delivery_record":
            video_job = data.get("video_job", {})
            record = {
                "delivery_id": uuid.uuid4().hex,
                "project_id": data.get("project_id", ""),
                "video_job_id": video_job.get("job_id", ""),
                "qa_report_id": data.get("qa_report", {}).get("report_id", ""),
                "delivery_format": data.get("delivery_format", "mp4"),
                "delivery_url": data.get("prepared_url", ""),
                "delivery_method": data.get("delivery_method", "download_link"),
                "cost_summary": {
                    "video_gen_cost_cents": video_job.get("cost_cents", 0),
                    "llm_cost_cents": data.get("llm_cost_cents", 0),
                    "total_cost_cents": video_job.get("cost_cents", 0) + data.get("llm_cost_cents", 0),
                    "revision_count": data.get("revision_count", 0),
                },
                "status": "preparing",
                "created_at": datetime.utcnow().isoformat(),
            }
            return {"delivery_record": record}

        elif step_name == "deliver":
            record = data.get("delivery_record", {})
            result = await self.delivery_agent.run({
                "action": "deliver",
                "delivery_record": record,
                "delivery_method": record.get("delivery_method", "download_link"),
            })
            if not result.success:
                raise RuntimeError(f"Delivery failed: {result.error}")

            record["status"] = "delivered"
            record["delivered_at"] = datetime.utcnow().isoformat()
            record.update(result.data)
            return {"delivery_record": record}

        raise ValueError(f"Unknown step: {step_name}")
