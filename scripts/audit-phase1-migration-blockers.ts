import { createHash } from "node:crypto";

async function main(): Promise<void> {
  const url = process.env.NEON_REHEARSAL_OWNER_DATABASE_URL;
  if (!url) throw new Error("NEON_REHEARSAL_OWNER_DATABASE_URL is required");
  process.env.DATABASE_URL = url;

  const { db } = await import("../src/lib/db");
  const rows = await db.$queryRaw<
    Array<{ id: string; email: string; role: string; userType: string }>
  >`
    SELECT "id", "email", "role"::text AS "role", "userType"::text AS "userType"
    FROM "AdminUser"
    WHERE "userType" IN ('BUSINESS', 'PERSONAL')
      AND "role" <> 'OPERATOR'
    ORDER BY "createdAt", "id"
  `;

  const result = rows.map(({ id, email, role, userType }) => ({
    id,
    accountFingerprint: createHash("sha256")
      .update(email.trim().toLowerCase())
      .digest("hex")
      .slice(0, 12),
    role,
    userType,
  }));
  process.stdout.write(JSON.stringify({ count: result.length, rows: result }, null, 2) + "\n");
  await db.$disconnect();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "audit failed"}\n`);
  process.exitCode = 1;
});
