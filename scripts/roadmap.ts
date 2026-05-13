/**
 * `npm run roadmap` —— 一行命令告诉你「现在走到哪了」。
 *
 * 读两个来源：
 *   1. docs/ROADMAP_STATUS.md —— 「一句话现状」 + 「Recent commits & status」 + 「Next session resume hook」
 *   2. git log -3 --oneline    —— 最近三条 commit
 *
 * 用途：换 chat / 换 agent / 隔了几天回来时，这是最快的 catch-up。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATUS_FILE = path.join(ROOT, "docs/ROADMAP_STATUS.md");

function readSection(file: string, header: string): string | null {
  if (!existsSync(file)) return null;
  const content = readFileSync(file, "utf8");
  const re = new RegExp(`(?:^|\\n)##+\\s+${escapeRegex(header)}\\s*\\n([\\s\\S]*?)(?=\\n##+\\s|\\n---|$)`);
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gitLog(): string {
  try {
    return execFileSync("git", ["log", "-3", "--oneline"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "(git not available)";
  }
}

function gitBranchAndPushStatus(): string {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    const status = execFileSync("git", ["status", "-sb"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    return `${branch} · ${status.split("\n")[0]}`;
  } catch {
    return "(git not available)";
  }
}

function bar(s: string) {
  console.log("\n" + "═".repeat(72));
  console.log(`  ${s}`);
  console.log("═".repeat(72));
}

function main() {
  bar("Aivora · Roadmap Status");

  if (!existsSync(STATUS_FILE)) {
    console.log("  ⚠️ docs/ROADMAP_STATUS.md missing");
    console.log("  Initialize it before resuming work.");
    return;
  }

  const oneLiner = readSection(STATUS_FILE, "一句话现状");
  const resume = readSection(STATUS_FILE, "Next session resume hook");
  const recent = readSection(STATUS_FILE, "Recent commits & status");

  console.log("\n  ── 一句话现状 ──");
  console.log(indent(oneLiner ?? "(not found)"));

  console.log("\n  ── git ──");
  console.log("  branch  : " + gitBranchAndPushStatus());
  console.log("  log -3  :");
  console.log(indent(gitLog(), 4));

  if (recent) {
    console.log("\n  ── recent commits (per ROADMAP_STATUS.md) ──");
    console.log(indent(recent));
  }

  if (resume) {
    console.log("\n  ── next session resume hook ──");
    console.log(indent(resume));
  }

  console.log("\n  Tip: 完整 roadmap 见 docs/ROADMAP_STATUS.md（每完成一个 phase 必须更新）\n");
}

function indent(s: string, n: number = 2): string {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

main();
