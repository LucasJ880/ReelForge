/**
 * Pexels 视频搜索 Provider（Free 通道素材来源）
 *
 * - 需要 PEXELS_API_KEY（免费申请: https://www.pexels.com/api/）
 * - Mock 模式（无 key 或 VIDEO_ENGINE_MOCK=true）：返回内置的公开竖屏样片
 */

export interface PexelsVideo {
  id: string;
  url: string; // HLS/MP4 链接（我们挑 portrait mp4）
  thumbnail: string;
  width: number;
  height: number;
  duration: number; // 秒
  user: string;
}

const MOCK_VIDEOS: PexelsVideo[] = [
  // Pexels 官方公开样片（竖屏 9:16，适合 TikTok/抖音尺寸）
  {
    id: "mock-1",
    url: "https://videos.pexels.com/video-files/3209828/3209828-hd_1080_1920_25fps.mp4",
    thumbnail: "https://images.pexels.com/videos/3209828/pictures/preview-0.jpg",
    width: 1080,
    height: 1920,
    duration: 10,
    user: "Pexels",
  },
  {
    id: "mock-2",
    url: "https://videos.pexels.com/video-files/4763824/4763824-hd_1080_1920_30fps.mp4",
    thumbnail: "https://images.pexels.com/videos/4763824/pictures/preview-0.jpg",
    width: 1080,
    height: 1920,
    duration: 8,
    user: "Pexels",
  },
  {
    id: "mock-3",
    url: "https://videos.pexels.com/video-files/5752729/5752729-hd_1080_1920_25fps.mp4",
    thumbnail: "https://images.pexels.com/videos/5752729/pictures/preview-0.jpg",
    width: 1080,
    height: 1920,
    duration: 12,
    user: "Pexels",
  },
];

function isMockMode(): boolean {
  if (process.env.VIDEO_ENGINE_MOCK === "true") return true;
  if (!process.env.PEXELS_API_KEY) return true;
  return false;
}

/**
 * 按关键词搜索竖屏视频
 * @param query 搜索关键词（建议中英文混合或走翻译）
 * @param perPage 每页返回数量（默认 5，最大 80）
 */
export async function searchPexelsVideos(
  query: string,
  perPage = 5,
): Promise<PexelsVideo[]> {
  if (isMockMode()) {
    // Mock：根据 query hash 挑选并循环
    const n = Math.max(1, Math.min(perPage, MOCK_VIDEOS.length * 3));
    const result: PexelsVideo[] = [];
    for (let i = 0; i < n; i++) {
      const pick = MOCK_VIDEOS[(query.length + i) % MOCK_VIDEOS.length];
      result.push({ ...pick, id: `${pick.id}-${i}` });
    }
    return result;
  }

  const apiKey = process.env.PEXELS_API_KEY!;
  const params = new URLSearchParams({
    query,
    orientation: "portrait",
    size: "medium",
    per_page: String(perPage),
  });

  const res = await fetch(`https://api.pexels.com/videos/search?${params}`, {
    headers: { Authorization: apiKey },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Pexels API ${res.status}: ${await res.text()}`);
  }

  type PexelsApiResponse = {
    videos: Array<{
      id: number;
      duration: number;
      user?: { name?: string };
      image: string;
      video_files: Array<{
        link: string;
        width: number;
        height: number;
        file_type: string;
        quality?: string;
      }>;
    }>;
  };

  const data = (await res.json()) as PexelsApiResponse;

  const videos: PexelsVideo[] = [];
  for (const v of data.videos ?? []) {
    // 挑最佳竖屏 mp4：height > width 且质量优先 hd/sd
    const candidates = v.video_files
      .filter((f) => f.file_type === "video/mp4" && f.height >= f.width)
      .sort((a, b) => b.height - a.height);
    const pick = candidates[0] ?? v.video_files[0];
    if (!pick) continue;
    videos.push({
      id: String(v.id),
      url: pick.link,
      thumbnail: v.image,
      width: pick.width,
      height: pick.height,
      duration: v.duration,
      user: v.user?.name ?? "Pexels",
    });
  }

  return videos;
}

/**
 * 按多个关键词并行搜索并扁平化结果
 */
export async function searchPexelsMulti(
  queries: string[],
  perQuery = 3,
): Promise<PexelsVideo[]> {
  const results = await Promise.all(
    queries.map((q) => searchPexelsVideos(q, perQuery).catch(() => [])),
  );
  return results.flat();
}
