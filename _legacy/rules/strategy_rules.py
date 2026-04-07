"""内容策略规则引擎"""

PLATFORM_BEST_PRACTICES = {
    "tiktok": {
        "optimal_duration": [15, 30, 60],
        "best_posting_times": ["07:00", "12:00", "19:00", "22:00"],
        "hashtag_count": {"min": 3, "max": 8},
        "caption_max_length": 2200,
        "trends_refresh_days": 3,
    },
    "youtube_shorts": {
        "optimal_duration": [30, 45, 58],
        "best_posting_times": ["09:00", "14:00", "17:00"],
        "hashtag_count": {"min": 3, "max": 15},
        "caption_max_length": 100,
        "trends_refresh_days": 7,
    },
    "instagram_reels": {
        "optimal_duration": [15, 30, 60],
        "best_posting_times": ["08:00", "13:00", "18:00"],
        "hashtag_count": {"min": 5, "max": 30},
        "caption_max_length": 2200,
        "trends_refresh_days": 5,
    },
}

CONTENT_GOAL_TEMPLATES = {
    "brand_awareness": {
        "recommended_formats": ["storytelling", "behind_the_scenes", "brand_values"],
        "cta_types": ["follow", "share", "learn_more"],
        "tone_suggestion": "authentic, relatable",
    },
    "product_promotion": {
        "recommended_formats": ["demo", "tutorial", "comparison", "unboxing"],
        "cta_types": ["shop_now", "link_in_bio", "use_code"],
        "tone_suggestion": "enthusiastic, informative",
    },
    "lead_generation": {
        "recommended_formats": ["educational", "tips", "free_resource"],
        "cta_types": ["sign_up", "download", "dm_for_info"],
        "tone_suggestion": "authoritative, helpful",
    },
    "engagement": {
        "recommended_formats": ["challenge", "poll", "duet", "trend"],
        "cta_types": ["comment", "stitch", "try_this"],
        "tone_suggestion": "fun, interactive",
    },
}


def get_platform_guidelines(platform: str) -> dict:
    return PLATFORM_BEST_PRACTICES.get(platform, PLATFORM_BEST_PRACTICES["tiktok"])


def get_goal_template(content_goal: str) -> dict:
    return CONTENT_GOAL_TEMPLATES.get(content_goal, CONTENT_GOAL_TEMPLATES["brand_awareness"])


def validate_strategy(strategy: dict, platform: str = "tiktok") -> list[str]:
    """验证策略是否合理"""
    warnings = []
    guidelines = get_platform_guidelines(platform)

    topics = strategy.get("topic_suggestions", [])
    if len(topics) < 3:
        warnings.append("建议至少提供3个选题方向")

    hashtags = strategy.get("hashtag_strategy", {})
    primary = hashtags.get("primary_hashtags", [])
    h_range = guidelines["hashtag_count"]
    total = len(primary) + len(hashtags.get("secondary_hashtags", []))
    if total < h_range["min"]:
        warnings.append(f"Hashtag 数量({total})低于推荐最少值({h_range['min']})")

    return warnings
