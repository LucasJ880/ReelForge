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
    // Step 1: Download video from source URL into memory
    console.log("[tiktok] Downloading video from source...");
    const videoRes = await fetch(options.videoUrl);
    if (!videoRes.ok) {
      return {
        publishId: "",
        status: "failed",
        errorMessage: `无法下载视频: ${videoRes.status}`,
      };
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoSize = videoBuffer.length;
    console.log(`[tiktok] Video downloaded: ${(videoSize / 1024 / 1024).toFixed(2)} MB`);

    // Step 2: Query creator info for privacy levels
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

    // Sandbox/unaudited apps must use SELF_ONLY; production apps can upgrade later
    const isSandbox = process.env.TIKTOK_CLIENT_KEY?.startsWith("sb");
    let privacyLevel = "SELF_ONLY";
    if (!isSandbox && creatorRes.ok) {
      const creatorData = await creatorRes.json();
      const levels = creatorData.data?.privacy_level_options || [];
      if (levels.includes("PUBLIC_TO_EVERYONE")) {
        privacyLevel = "PUBLIC_TO_EVERYONE";
      } else if (levels.includes("MUTUAL_FOLLOW_FRIENDS")) {
        privacyLevel = "MUTUAL_FOLLOW_FRIENDS";
      } else if (levels.includes("FOLLOWER_OF_CREATOR")) {
        privacyLevel = "FOLLOWER_OF_CREATOR";
      }
    }
    console.log(`[tiktok] Privacy level: ${privacyLevel} (sandbox: ${isSandbox})`);

    // Step 3: Init FILE_UPLOAD with TikTok
    const chunkSize = Math.min(videoSize, 10_000_000);
    const totalChunkCount = Math.ceil(videoSize / chunkSize);

    const initRes = await fetch(
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
            source: "FILE_UPLOAD",
            video_size: videoSize,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount,
          },
        }),
      }
    );

    const initData = await initRes.json();
    console.log("[tiktok] Init response:", JSON.stringify(initData));

    if (initData.error?.code !== "ok") {
      return {
        publishId: "",
        status: "failed",
        errorMessage: `TikTok Init: ${initData.error?.code} - ${initData.error?.message || "未知错误"}`,
      };
    }

    const uploadUrl = initData.data?.upload_url;
    const publishId = initData.data?.publish_id || "";

    if (!uploadUrl) {
      return {
        publishId,
        status: "failed",
        errorMessage: "TikTok 未返回 upload_url",
      };
    }

    // Step 4: Upload video chunks
    for (let i = 0; i < totalChunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, videoSize) - 1;
      const chunk = videoBuffer.subarray(start, end + 1);

      console.log(`[tiktok] Uploading chunk ${i + 1}/${totalChunkCount}: bytes ${start}-${end}/${videoSize}`);
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes ${start}-${end}/${videoSize}`,
          "Content-Type": "video/mp4",
        },
        body: chunk,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        return {
          publishId,
          status: "failed",
          errorMessage: `上传失败 chunk ${i + 1}: ${uploadRes.status} ${errText}`,
        };
      }
    }

    console.log(`[tiktok] Upload complete. publish_id: ${publishId}`);
    return {
      publishId,
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
