"""QA 质检规则引擎 - 不依赖 LLM 的确定性检查"""

from dataclasses import dataclass


@dataclass
class QAIssue:
    type: str      # visual, audio, content, technical
    severity: str  # critical, major, minor, info
    description: str
    suggestion: str = ""


PLATFORM_SPECS = {
    "tiktok": {
        "max_duration_seconds": 180,
        "min_duration_seconds": 5,
        "recommended_aspect_ratio": "9:16",
        "max_file_size_mb": 287,
        "recommended_resolution": "1080x1920",
    },
    "youtube_shorts": {
        "max_duration_seconds": 60,
        "min_duration_seconds": 5,
        "recommended_aspect_ratio": "9:16",
        "max_file_size_mb": 256,
        "recommended_resolution": "1080x1920",
    },
    "instagram_reels": {
        "max_duration_seconds": 90,
        "min_duration_seconds": 5,
        "recommended_aspect_ratio": "9:16",
        "max_file_size_mb": 250,
        "recommended_resolution": "1080x1920",
    },
}


def check_duration(actual_seconds: float, platform: str = "tiktok") -> list[QAIssue]:
    """检查视频时长是否符合平台要求"""
    issues = []
    spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["tiktok"])
    if actual_seconds > spec["max_duration_seconds"]:
        issues.append(QAIssue(
            type="technical", severity="critical",
            description=f"视频时长 {actual_seconds}s 超过 {platform} 限制 {spec['max_duration_seconds']}s",
            suggestion="缩短视频时长"
        ))
    if actual_seconds < spec["min_duration_seconds"]:
        issues.append(QAIssue(
            type="technical", severity="major",
            description=f"视频时长 {actual_seconds}s 低于最低要求 {spec['min_duration_seconds']}s",
            suggestion="增加视频内容"
        ))
    return issues


def check_file_size(size_mb: float, platform: str = "tiktok") -> list[QAIssue]:
    spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["tiktok"])
    issues = []
    if size_mb > spec["max_file_size_mb"]:
        issues.append(QAIssue(
            type="technical", severity="critical",
            description=f"文件大小 {size_mb}MB 超过限制 {spec['max_file_size_mb']}MB",
            suggestion="压缩视频或降低分辨率"
        ))
    return issues


def check_script_quality(script: dict) -> list[QAIssue]:
    """检查脚本质量的规则"""
    issues = []
    if not script.get("hook"):
        issues.append(QAIssue(type="content", severity="major", description="缺少开头吸引语(hook)", suggestion="添加前3秒的吸引语"))
    if not script.get("cta"):
        issues.append(QAIssue(type="content", severity="minor", description="缺少行动号召(CTA)", suggestion="添加结尾CTA"))

    voiceover = script.get("voiceover_text", "")
    duration = script.get("duration_seconds", 30)
    if voiceover:
        words = len(voiceover.split())
        words_per_second = words / max(duration, 1)
        if words_per_second > 3.5:
            issues.append(QAIssue(
                type="content", severity="major",
                description=f"口播语速过快 ({words_per_second:.1f} 词/秒), 建议不超过 3.5 词/秒",
                suggestion="精简口播文案或增加视频时长"
            ))
    return issues


def run_all_checks(video_metadata: dict, script: dict, platform: str = "tiktok") -> list[QAIssue]:
    """运行所有规则检查"""
    issues = []
    if "duration_seconds" in video_metadata:
        issues.extend(check_duration(video_metadata["duration_seconds"], platform))
    if "file_size_mb" in video_metadata:
        issues.extend(check_file_size(video_metadata["file_size_mb"], platform))
    issues.extend(check_script_quality(script))
    return issues
