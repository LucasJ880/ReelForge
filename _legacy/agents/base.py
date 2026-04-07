from abc import ABC, abstractmethod
from typing import Any
from datetime import datetime
import structlog
import uuid

logger = structlog.get_logger()


class AgentResult:
    """Agent 执行结果的标准封装"""

    def __init__(
        self,
        success: bool,
        data: dict[str, Any] | None = None,
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        self.success = success
        self.data = data or {}
        self.error = error
        self.metadata = metadata or {}
        self.timestamp = datetime.utcnow().isoformat()
        self.trace_id = uuid.uuid4().hex


class BaseAgent(ABC):
    """所有 Agent 的基类，统一接口和日志"""

    name: str = "base_agent"
    description: str = ""
    version: str = "0.1.0"

    def __init__(self):
        self.logger = logger.bind(agent=self.name)

    async def run(self, input_data: dict[str, Any]) -> AgentResult:
        """执行入口，包含统一的日志和错误处理"""
        self.logger.info("agent.start", input_keys=list(input_data.keys()))
        try:
            self.validate_input(input_data)
            result = await self.execute(input_data)
            self.logger.info("agent.complete", success=result.success)
            return result
        except Exception as e:
            self.logger.error("agent.failed", error=str(e))
            return AgentResult(success=False, error=str(e))

    @abstractmethod
    async def execute(self, input_data: dict[str, Any]) -> AgentResult:
        """子类实现具体逻辑"""
        ...

    def validate_input(self, input_data: dict[str, Any]) -> None:
        """输入验证，子类可覆盖"""
        pass
