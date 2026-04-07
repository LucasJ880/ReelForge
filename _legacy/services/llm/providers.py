from dataclasses import dataclass
from services.llm.client import LLMClient


@dataclass
class ProviderConfig:
    name: str
    model: str
    api_key: str | None = None
    base_url: str | None = None
    cost_per_1k_input: float = 0.0
    cost_per_1k_output: float = 0.0


PROVIDER_REGISTRY: dict[str, ProviderConfig] = {
    "openai_gpt4o": ProviderConfig(
        name="openai",
        model="gpt-4o",
        cost_per_1k_input=0.0025,
        cost_per_1k_output=0.01,
    ),
    "openai_gpt4o_mini": ProviderConfig(
        name="openai",
        model="gpt-4o-mini",
        cost_per_1k_input=0.00015,
        cost_per_1k_output=0.0006,
    ),
    "deepseek_chat": ProviderConfig(
        name="deepseek",
        model="deepseek/deepseek-chat",
        cost_per_1k_input=0.00014,
        cost_per_1k_output=0.00028,
    ),
}


def create_llm_client(provider_key: str = "openai_gpt4o", api_key: str | None = None) -> LLMClient:
    """根据 provider key 创建 LLM 客户端"""
    config = PROVIDER_REGISTRY.get(provider_key)
    if not config:
        raise ValueError(f"Unknown provider: {provider_key}. Available: {list(PROVIDER_REGISTRY.keys())}")
    return LLMClient(default_model=config.model, api_key=api_key or config.api_key)


def estimate_cost(provider_key: str, input_tokens: int, output_tokens: int) -> float:
    """估算 LLM 调用成本（美元）"""
    config = PROVIDER_REGISTRY.get(provider_key)
    if not config:
        return 0.0
    return (
        input_tokens / 1000 * config.cost_per_1k_input
        + output_tokens / 1000 * config.cost_per_1k_output
    )
