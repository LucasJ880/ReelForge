/**
 * TikTok 发布 & 数据拉取 Provider
 *
 * Mock 模式：模拟发布和数据拉取流程
 * Real 模式：调用 TikTok Content Posting API + Video Query API
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

function isMockMode(): boolean {
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
          title: options.caption,
          privacy_level: "SELF_ONLY",
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

  if (!res.ok) {
    const err = await res.text();
    return {
      publishId: "",
      status: "failed",
      errorMessage: `TikTok API 错误: ${res.status} ${err}`,
    };
  }

  const data = await res.json();
  return {
    publishId: data.data?.publish_id || "",
    status: "pending",
  };
}

// ============================================================
// 数据拉取
// ============================================================

export async function fetchVideoMetrics(
  platformVideoId: string,
  accessToken: string
): Promise<VideoMetrics> {
  if (isMockMode()) return fetchMetricsMock(platformVideoId);
  return fetchMetricsReal(platformVideoId, accessToken);
}

function fetchMetricsMock(_platformVideoId: string): VideoMetrics {
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
    "https://open.tiktokapis.com/v2/video/query/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        filters: { video_ids: [platformVideoId] },
        fields: ["view_count", "like_count", "comment_count", "share_count"],
      }),
    }
  );

  if (!res.ok) throw new Error(`TikTok API 查询失败: ${res.status}`);

  const data = await res.json();
  const video = data.data?.videos?.[0];

  return {
    views: video?.view_count ?? 0,
    likes: video?.like_count ?? 0,
    comments: video?.comment_count ?? 0,
    shares: video?.share_count ?? 0,
  };
}
