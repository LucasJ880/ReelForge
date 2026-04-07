/**
 * TikTok 发布 & 数据拉取 Provider
 *
 * Mock 模式：无 TIKTOK_CLIENT_KEY 时使用模拟数据
 * Real 模式：调用 TikTok Content Posting API + Display API
 */

export interface PublishOptions {
  videoUrl: string;
  caption: string;
  accessToken: string;
  openId: string;
}

export interface PublishResult {
  publishId: string;
  platformVideoId?: string;
  status: "pending" | "published" | "failed";
  errorMessage?: string;
}

export interface VideoMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export function isMockMode(): boolean {
  return !process.env.TIKTOK_CLIENT_KEY;
}

// ============================================================
// 发布
// ============================================================

export async function publishVideo(
  options: PublishOptions
): Promise<PublishResult> {
  if (isMockMode()) return publishMock(options);
  return publishReal(options);
}

function publishMock(_options: PublishOptions): PublishResult {
  const publishId = `pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[tiktok:mock] 视频已模拟发布: ${publishId}`);
  return {
    publishId,
    platformVideoId: `tv_mock_${Date.now()}`,
    status: "published",
  };
}

async function publishReal(options: PublishOptions): Promise<PublishResult> {
  try {
    // Step 1: Query creator info to get available privacy levels
    const creatorRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    let privacyLevel = "SELF_ONLY";
    if (creatorRes.ok) {
      const creatorData = await creatorRes.json();
      const levels = creatorData.data?.privacy_level_options || [];
      if (levels.includes("PUBLIC_TO_EVERYONE")) {
        privacyLevel = "PUBLIC_TO_EVERYONE";
      } else if (levels.includes("MUTUAL_FOLLOW_FRIENDS")) {
        privacyLevel = "MUTUAL_FOLLOW_FRIENDS";
      }
    }

    // Step 2: Init video post via PULL_FROM_URL
    const res = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: options.caption.slice(0, 2200),
            privacy_level: privacyLevel,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: options.videoUrl,
          },
        }),
      }
    );

    const data = await res.json();

    if (data.error?.code !== "ok") {
      return {
        publishId: "",
        status: "failed",
        errorMessage: `TikTok API: ${data.error?.code} - ${data.error?.message || "未知错误"}`,
      };
    }

    return {
      publishId: data.data?.publish_id || "",
      status: "pending",
    };
  } catch (err) {
    return {
      publishId: "",
      status: "failed",
      errorMessage: `TikTok 发布异常: ${(err as Error).message}`,
    };
  }
}

// ============================================================
// 发布状态查询
// ============================================================

export async function checkPublishStatus(
  publishId: string,
  accessToken: string
): Promise<{ status: string; platformVideoId?: string; errorMessage?: string }> {
  if (isMockMode()) {
    return { status: "publish_complete", platformVideoId: `tv_mock_${Date.now()}` };
  }

  try {
    const res = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      }
    );

    const data = await res.json();
    const status = data.data?.status;

    return {
      status: status || "unknown",
      platformVideoId: data.data?.publicaly_available_post_id?.[0] || undefined,
      errorMessage: data.data?.fail_reason,
    };
  } catch (err) {
    return { status: "error", errorMessage: (err as Error).message };
  }
}

// ============================================================
// 数据拉取 (Display API)
// ============================================================

export async function fetchVideoMetrics(
  platformVideoId: string,
  accessToken: string
): Promise<VideoMetrics> {
  if (isMockMode()) return fetchMetricsMock();
  return fetchMetricsReal(platformVideoId, accessToken);
}

function fetchMetricsMock(): VideoMetrics {
  return {
    views: Math.floor(Math.random() * 10000) + 100,
    likes: Math.floor(Math.random() * 500) + 10,
    comments: Math.floor(Math.random() * 100) + 2,
    shares: Math.floor(Math.random() * 50) + 1,
  };
}

async function fetchMetricsReal(
  platformVideoId: string,
  accessToken: string
): Promise<VideoMetrics> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/video/query/?fields=view_count,like_count,comment_count,share_count",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        filters: { video_ids: [platformVideoId] },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TikTok Display API 错误: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const video = data.data?.videos?.[0];

  return {
    views: video?.view_count ?? 0,
    likes: video?.like_count ?? 0,
    comments: video?.comment_count ?? 0,
    shares: video?.share_count ?? 0,
  };
}
