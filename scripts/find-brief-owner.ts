/** 只读：查卡住 brief 的归属用户（email / userType / persona）。 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const BRIEF_ID = process.argv[2] ?? "cmrcbuaji000rl404hzi2gzht";

async function main() {
  const { db } = await import("../src/lib/db");
  const brief = await db.videoBrief.findUnique({
    where: { id: BRIEF_ID },
    select: {
      persona: true,
      contentAngle: {
        select: {
          round: {
            select: {
              deliveryOrder: {
                select: {
                  id: true,
                  createdBy: {
                    select: { id: true, email: true, userType: true, name: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  console.log(JSON.stringify(brief, null, 2));
}

main().then(() => process.exit(0));
