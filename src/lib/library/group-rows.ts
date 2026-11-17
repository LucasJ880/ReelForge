import { libraryHeadline } from "@/lib/library/display-title";

/**
 * 成品库按商品分组（2026-11-17）。之前是一张平铺的大网格：同一件商品的几条片标题一模一样、分不出谁是谁，
 * 做得多了往前翻就是一堆重复的卡片。现在每件商品一栏，栏里按时间倒序排它的几条片；每条片用开头那句台词来区分。
 * 纯函数、不引服务端模块。
 */

export interface GroupableLibraryRow {
  id: string;
  title: string;
  source: "order" | "batch" | "post";
  isShowcase: boolean;
  updatedAt: Date;
}

export interface LibraryProductGroup<Row extends GroupableLibraryRow> {
  key: string;
  /// 这一栏的名字：商品名 / 这几条片在讲什么（描述的第一小句）
  name: string;
  /// 只读样片（不是访问者自己的片）单独成栏
  isShowcase: boolean;
  /// 时间倒序
  rows: Row[];
  latest: Date;
}

/** 这一行归到哪件商品：批量成片的标题是「商品名 #序号 · 模板名」，取商品名；其余取描述的第一小句。 */
export function libraryGroupName(row: Pick<GroupableLibraryRow, "title" | "source">): string {
  const base = row.source === "batch" ? row.title.split(/\s#\d+/u)[0] ?? row.title : row.title;
  return libraryHeadline(base);
}

/** 按商品分组：栏按「最近做过的在前」排，样片栏永远放最后。 */
export function groupLibraryRows<Row extends GroupableLibraryRow>(rows: readonly Row[]): LibraryProductGroup<Row>[] {
  const groups = new Map<string, LibraryProductGroup<Row>>();
  for (const row of rows) {
    const name = libraryGroupName(row);
    const key = `${row.isShowcase ? "showcase" : "own"}:${name.toLocaleLowerCase()}`;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      if (row.updatedAt > group.latest) group.latest = row.updatedAt;
    } else {
      groups.set(key, { key, name, isShowcase: row.isShowcase, rows: [row], latest: row.updatedAt });
    }
  }
  const list = [...groups.values()];
  for (const group of list) group.rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return list.sort((a, b) =>
    a.isShowcase === b.isShowcase ? b.latest.getTime() - a.latest.getTime() : a.isShowcase ? 1 : -1,
  );
}

/**
 * 这条片开头说的那句话（从后期快照的口播稿里取第一句）：同一件商品的几条片靠它区分。
 * 没开口播、没有稿子、快照读不懂 → null。
 */
export function firstSpokenLine(postProduction: unknown, maxChars = 18): string | null {
  if (!postProduction || typeof postProduction !== "object") return null;
  const audio = (postProduction as { audio?: unknown }).audio;
  const voiceover = audio && typeof audio === "object" ? (audio as { voiceover?: unknown }).voiceover : null;
  if (!voiceover || typeof voiceover !== "object") return null;
  const { enabled, script } = voiceover as { enabled?: unknown; script?: unknown };
  if (enabled !== true || typeof script !== "string") return null;
  const first = script.trim().split(/(?<=[。！？!?])\s*|\n+/u)[0]?.replace(/[。！!]$/u, "").trim() ?? "";
  if (!first) return null;
  const chars = Array.from(first);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : first;
}
