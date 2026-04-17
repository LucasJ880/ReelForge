import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 产品目录已下线 —— 现在由用户在创建项目时自由填写 brandDescription + 上传参考图。
// 此 seed 文件保留作为占位；如需初始化用户/默认 batch 等全局数据可在此补充。

async function main() {
  console.log("Nothing to seed. Aivora now uses user-provided brand descriptions + reference images.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
