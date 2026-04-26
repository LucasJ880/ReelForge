/**
 * 列出当前 HeyGen 账号能用的 avatar，挑选更职业（西装/商务/经纪）风格的人选。
 * 跑法：npx tsx scripts/list-heygen-avatars.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY 未配置");

  const res = await fetch("https://api.heygen.com/v2/avatars", {
    headers: { "X-Api-Key": apiKey },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen avatars 查询失败 ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    data?: {
      avatars?: Array<{
        avatar_id: string;
        avatar_name?: string;
        gender?: string;
        preview_image_url?: string;
        preview_video_url?: string;
        premium?: boolean;
        default_voice_id?: string | null;
        tags?: string[];
      }>;
    };
  };
  const list = data.data?.avatars ?? [];
  console.log(`总计 ${list.length} 个 avatar`);

  const KEYS = [
    "business",
    "suit",
    "blazer",
    "professional",
    "corporate",
    "office",
    "agent",
    "real estate",
    "broker",
    "anchor",
    "presenter",
    "host",
    "executive",
    "expressive",
  ];
  const scored = list
    .map((a) => {
      const hay = `${a.avatar_id} ${a.avatar_name ?? ""} ${(a.tags ?? []).join(" ")}`.toLowerCase();
      let score = 0;
      for (const k of KEYS) if (hay.includes(k)) score += 1;
      if (a.premium) score += 0.5;
      return { ...a, score };
    })
    .sort((x, y) => y.score - x.score)
    .filter((a) => a.score > 0)
    .slice(0, 30);

  console.log("\n=== 候选职业风 avatar (top 30) ===");
  for (const a of scored) {
    console.log(
      [
        a.avatar_id.padEnd(45),
        (a.avatar_name ?? "-").padEnd(28),
        (a.gender ?? "-").padEnd(8),
        `score=${a.score}`,
        a.premium ? "💎" : "  ",
        (a.tags ?? []).slice(0, 4).join(","),
      ].join(" | "),
    );
  }

  console.log("\n=== 全量样本（前 50） ===");
  for (const a of list.slice(0, 50)) {
    console.log(
      [
        a.avatar_id.padEnd(45),
        (a.avatar_name ?? "-").padEnd(28),
        (a.gender ?? "-").padEnd(8),
        a.premium ? "💎" : "  ",
        (a.tags ?? []).slice(0, 4).join(","),
      ].join(" | "),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
