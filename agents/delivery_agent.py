from agents.base import BaseAgent, AgentResult
from typing import Any
from datetime import datetime
import uuid


class DeliveryAgent(BaseAgent):
    name = "delivery_agent"
    description = "交付记录与输出准备"

    def __init__(self, file_store=None):
        super().__init__()
        self.file_store = file_store

    def validate_input(self, input_data: dict[str, Any]) -> None:
        required = ["video_job", "qa_report", "project"]
        missing = [k for k in required if k not in input_data]
        if missing:
            raise ValueError(f"缺少必要字段: {missing}")

    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        video_job = input_data["video_job"]
        qa_report = input_data["qa_report"]
        project = input_data["project"]

        if not qa_report.get("auto_pass", False):
            return AgentResult(
                success=False,
                error="QA 未通过，无法交付",
                data={
                    "qa_score": qa_report.get("overall_score"),
                    "issues": qa_report.get("issues", []),
                },
            )

        delivery_url = await self._prepare_delivery(video_job, project)

        delivery_record = self._create_delivery_record(video_job, qa_report, project, delivery_url)

        if self.file_store:
            await self._save_delivery_metadata(delivery_record)

        return AgentResult(success=True, data={"delivery_record": delivery_record})

    async def _prepare_delivery(self, video_job: dict, project: dict) -> str:
        """准备交付文件，返回交付 URL"""
        output_url = video_job.get("output_url", "")
        if self.file_store and output_url:
            try:
                data = self.file_store.load(output_url.replace("file://", ""))
                delivery_path = self.file_store.save(
                    data,
                    filename=f"delivery_{video_job.get('job_id', 'unknown')}.mp4",
                    subdir="deliveries",
                )
                return self.file_store.get_url(delivery_path)
            except (FileNotFoundError, Exception) as e:
                self.logger.warning("delivery.file_copy_failed", error=str(e))

        return output_url

    def _create_delivery_record(
        self, video_job: dict, qa_report: dict, project: dict, delivery_url: str
    ) -> dict:
        """创建交付记录"""
        return {
            "delivery_id": uuid.uuid4().hex,
            "project_id": project.get("project_id", "unknown"),
            "client_name": project.get("client_name", ""),
            "job_id": video_job.get("job_id"),
            "script_id": video_job.get("script_id"),
            "delivery_url": delivery_url,
            "delivery_format": "mp4",
            "qa_score": qa_report.get("overall_score"),
            "status": "delivered",
            "delivered_at": datetime.utcnow().isoformat(),
            "metadata": {
                "provider": video_job.get("provider"),
                "duration": video_job.get("metadata", {}).get("duration"),
                "resolution": video_job.get("metadata", {}).get("resolution"),
            },
        }

    async def _save_delivery_metadata(self, record: dict) -> None:
        """保存交付元数据"""
        import json
        try:
            metadata_bytes = json.dumps(record, ensure_ascii=False, indent=2).encode("utf-8")
            self.file_store.save(
                metadata_bytes,
                filename=f"delivery_{record['delivery_id']}.json",
                subdir="deliveries/metadata",
            )
            self.logger.info("delivery.metadata_saved", delivery_id=record["delivery_id"])
        except Exception as e:
            self.logger.warning("delivery.metadata_save_failed", error=str(e))
