"""Prompt 模板加载器 — 从文件加载并填充变量"""

from pathlib import Path
import json
from typing import Any

PROMPTS_DIR = Path(__file__).parent


def load_prompt(agent: str, filename: str) -> str:
    """加载 prompt 文件内容"""
    path = PROMPTS_DIR / agent / filename
    if not path.exists():
        raise FileNotFoundError(f"Prompt file not found: {path}")
    return path.read_text(encoding="utf-8").strip()


def render_prompt(template: str, variables: dict[str, Any]) -> str:
    """用变量填充 prompt 模板中的 {{variable}} 占位符"""
    result = template
    for key, value in variables.items():
        placeholder = "{{" + key + "}}"
        if isinstance(value, (dict, list)):
            rendered = json.dumps(value, indent=2, ensure_ascii=False, default=str)
        else:
            rendered = str(value)
        result = result.replace(placeholder, rendered)
    return result


def load_and_render(agent: str, filename: str, variables: dict[str, Any]) -> str:
    """加载模板并填充变量"""
    template = load_prompt(agent, filename)
    return render_prompt(template, variables)
