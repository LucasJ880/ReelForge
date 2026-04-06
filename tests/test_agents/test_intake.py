import pytest
from agents.intake_agent import IntakeAgent


@pytest.mark.asyncio
async def test_intake_agent_basic():
    agent = IntakeAgent(llm_client=None)
    result = await agent.run({
        "raw_requirements": "We need 5 TikTok videos for our new sneaker launch targeting Gen Z",
        "client_name": "TestBrand",
        "client_industry": "fashion",
        "platform": "tiktok",
    })
    assert result.success is True
    assert "brief" in result.data
    brief = result.data["brief"]
    assert brief["client_name"] == "TestBrand"
    assert brief["platform"] == "tiktok"


@pytest.mark.asyncio
async def test_intake_agent_missing_fields():
    agent = IntakeAgent(llm_client=None)
    result = await agent.run({
        "client_industry": "tech",
    })
    assert result.success is False
    assert "缺少必要字段" in result.error


@pytest.mark.asyncio
async def test_intake_agent_fallback_brief_structure():
    agent = IntakeAgent(llm_client=None)
    result = await agent.run({
        "raw_requirements": "Need product demo videos",
        "client_name": "Acme",
        "platform": "youtube_shorts",
    })
    assert result.success is True
    brief = result.data["brief"]
    assert "brief_id" in brief
    assert brief["status"] == "draft"
    assert brief["video_count"] >= 1
