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

/**
 * Mock 模式使用 Google 公共 GCS bucket 的经典测试 mp4 ——
 * 这些素材存在已超过 10 年、任何 IP 都能直接裸访问，不会 403/404。
 * 虽然不是竖屏，但我们的 ffmpeg composer 会强制 scale + crop 到 1080x1920，
 * 所以视觉上不影响（而且 mock 本就只是跑通流程用的占位）。
 *
 * 想要真实的竖屏素材？请在 Vercel 环境变量里配置 PEXELS_API_KEY
 * （免费申请：https://www.pexels.com/api/ ）。
 */
const MOCK_VIDEOS: PexelsVideo[] = [
  {
    id: "mock-bbb",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    thumbnail:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg",
    width: 1280,
    height: 720,
    duration: 596,
    user: "Blender Foundation",
  },
  {
    id: "mock-ed",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    thumbnail:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg",
    width: 1280,
    height: 720,
    duration: 653,
    user: "Blender Foundation",
  },
  {
    id: "mock-fbb",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    thumbnail:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerBlazes.jpg",
    width: 640,
    height: 360,
    duration: 15,
    user: "Google",
  },
  {
    id: "mock-fbj",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    thumbnail:
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerJoyrides.jpg",
    width: 640,
    height: 360,
    duration: 15,
    user: "Google",
  },
];

export function isPexelsMockMode(): boolean {
  if (process.env.VIDEO_ENGINE_MOCK === "true") return true;
  if (!process.env.PEXELS_API_KEY) return true;
  return false;
}

function isMockMode(): boolean {
  return isPexelsMockMode();
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
