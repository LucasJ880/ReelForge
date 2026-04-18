import { db } from "../src/lib/db";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("用法: tsx scripts/set-admin.ts <email>");
    process.exit(1);
  }

  const before = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      planTier: true,
      planExpiresAt: true,
    },
  });

  if (!before) {
    console.error(`✗ 未找到邮箱为 ${email} 的用户，请确认已注册`);
    process.exit(1);
  }

  console.log("BEFORE:", before);

  const after = await db.user.update({
    where: { email },
    data: { role: "ADMIN" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      planTier: true,
      planExpiresAt: true,
    },
  });

  console.log("AFTER :", after);
  console.log(`\n✓ ${email} 已设为 ADMIN`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
