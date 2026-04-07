import pytest
from rules.qa_rules import (
    check_duration,
    check_file_size,
    check_script_quality,
    run_all_checks,
)


def test_duration_within_limits():
    issues = check_duration(30, "tiktok")
    assert len(issues) == 0


def test_duration_exceeds_tiktok_limit():
    issues = check_duration(200, "tiktok")
    assert len(issues) == 1
    assert issues[0].severity == "critical"


def test_duration_too_short():
    issues = check_duration(2, "tiktok")
    assert len(issues) == 1
    assert issues[0].severity == "major"


def test_file_size_ok():
    issues = check_file_size(50, "tiktok")
    assert len(issues) == 0


def test_file_size_too_large():
    issues = check_file_size(300, "tiktok")
    assert len(issues) == 1


def test_script_missing_hook():
    issues = check_script_quality({"body": "some content", "cta": "follow us"})
    hook_issues = [i for i in issues if "hook" in i.description]
    assert len(hook_issues) == 1


def test_script_fast_voiceover():
    script = {
        "hook": "Hey check this out",
        "body": "content",
        "cta": "follow",
        "voiceover_text": " ".join(["word"] * 200),
        "duration_seconds": 30,
    }
    issues = check_script_quality(script)
    speed_issues = [i for i in issues if "语速" in i.description]
    assert len(speed_issues) == 1


def test_run_all_checks():
    video_metadata = {"duration_seconds": 30, "file_size_mb": 50}
    script = {"hook": "Hey!", "body": "content", "cta": "follow"}
    issues = run_all_checks(video_metadata, script, "tiktok")
    assert isinstance(issues, list)
