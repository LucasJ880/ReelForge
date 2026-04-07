"""统一的 LLM 调用客户端 — 封装 LiteLLM，支持多 provider"""

from typing import Any
import json
import os
import structlog

logger = structlog.get_logger()


class LLMClient:
    """统一的 LLM 调用客户端"""

    def __init__(self, default_model: str = "gpt-4o", api_key: str | None = None):
        self.default_model = default_model
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.logger = logger.bind(service="llm_client")
        self.total_tokens_used = 0
        self.total_calls = 0

    async def complete(
        self,
        prompt: str,
        system_prompt: str | None = None,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        response_format: dict | None = None,
    ) -> dict[str, Any]:
        """发送补全请求"""
        from litellm import acompletion

        model = model or self.default_model
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        self.logger.info("llm.request", model=model, prompt_len=len(prompt))

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if self.api_key:
            kwargs["api_key"] = self.api_key
        if response_format:
            kwargs["response_format"] = response_format

        last_error = None
        for attempt in range(3):
            try:
                response = await acompletion(**kwargs)
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                }
                self.total_tokens_used += usage["total_tokens"]
                self.total_calls += 1

                result = {
                    "content": response.choices[0].message.content,
                    "model": response.model,
                    "usage": usage,
                }
                self.logger.info(
                    "llm.response",
                    model=result["model"],
                    tokens=usage["total_tokens"],
                    attempt=attempt + 1,
                )
                return result
            except Exception as e:
                last_error = e
                self.logger.warning("llm.retry", attempt=attempt + 1, error=str(e))
                if attempt < 2:
                    import asyncio
                    await asyncio.sleep(2 ** attempt)

        raise RuntimeError(f"LLM call failed after 3 attempts: {last_error}")

    async def complete_json(
        self,
        prompt: str,
        system_prompt: str | None = None,
        model: str | None = None,
        temperature: float = 0.3,
    ) -> dict[str, Any]:
        """请求 JSON 格式返回并解析"""
        result = await self.complete(
            prompt=prompt,
            system_prompt=system_prompt,
            model=model,
            temperature=temperature,
            response_format={"type": "json_object"},
        )

        content = result["content"].strip()
        try:
            result["parsed"] = json.loads(content)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                result["parsed"] = json.loads(content[start:end])
            else:
                raise ValueError(f"LLM returned non-JSON content: {content[:200]}")

        return result
