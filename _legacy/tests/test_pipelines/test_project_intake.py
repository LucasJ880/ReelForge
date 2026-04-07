import pytest
from pipelines.project_intake import ProjectIntakePipeline


@pytest.mark.asyncio
async def test_project_intake_pipeline_success():
    pipeline = ProjectIntakePipeline(llm_client=None)
    result = await pipeline.run({
        "raw_requirements": "We need engaging TikTok videos for our coffee brand",
        "client_name": "BrewCo",
        "client_industry": "food_beverage",
        "platform": "tiktok",
    })
    assert result.status == "completed"
    assert "brief" in result.final_output


@pytest.mark.asyncio
async def test_project_intake_pipeline_missing_input():
    pipeline = ProjectIntakePipeline(llm_client=None)
    result = await pipeline.run({
        "client_industry": "tech",
    })
    assert result.status == "failed"
