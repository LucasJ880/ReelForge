import { readFile } from "node:fs/promises";

const REQUIRED = ["RF-002", "RF-003", "RF-004", "RF-005", "RF-006", "RF-007"];
const ledgerUrl = new URL("../DEFECTS.md", import.meta.url);
const ledger = await readFile(ledgerUrl, "utf8");

const results = REQUIRED.map((id) => {
  const section = ledger.match(
    new RegExp(
      `^### ${id}\\b[\\s\\S]*?(?=^### RF-|^## |(?![\\s\\S]))`,
      "m",
    ),
  )?.[0];
  const status = section?.match(/^- Status: \*\*(.+?)\*\*/m)?.[1] ?? "MISSING";
  return {
    id,
    status,
    verified: /^VERIFIED(?:\b|\s|—)/.test(status),
  };
});

const passed = results.every((result) => result.verified);
console.log(
  JSON.stringify(
    {
      gate: "C0",
      passed,
      verified: results.filter((result) => result.verified).length,
      required: results.length,
      results,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;
