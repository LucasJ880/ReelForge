import pytest
from services.video.generator import (
    MockVideoGenerator,
    VideoGenerationRequest,
    VideoProvider,
    create_video_generator,
)


@pytest.mark.asyncio
async def test_mock_generator_returns_completed():
    gen = MockVideoGenerator()
    request = VideoGenerationRequest(
        script_id="test123",
        prompt="A beautiful sunset over the ocean",
        duration_seconds=30,
    )
    result = await gen.generate(request)
    assert result.status == "completed"
    assert result.output_url is not None
    assert result.job_id


@pytest.mark.asyncio
async def test_mock_generator_check_status():
    gen = MockVideoGenerator()
    result = await gen.check_status("some_job_id")
    assert result.status == "completed"


def test_create_video_generator_mock():
    gen = create_video_generator(VideoProvider.MOCK)
    assert isinstance(gen, MockVideoGenerator)


def test_create_video_generator_unsupported():
    try:
        create_video_generator(VideoProvider.RUNWAY)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass
