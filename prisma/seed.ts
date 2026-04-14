import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SIZES_LIGHT = [
  { name: "Throw", dimensions: "50×60 inch" },
  { name: "Twin", dimensions: "60×80 inch" },
  { name: "Queen", dimensions: "90×90 inch" },
  { name: "King", dimensions: "108×90 inch" },
];

const SIZES_SHERPA = SIZES_LIGHT;

const FLANNEL_BASE_DESC =
  "SUNNY 法兰绒毛毯，采用优质合成纤维面料，提供天然纤维般的柔软与温暖。经过特殊抗起球处理，持久柔软、外观如新。适合沙发追剧、卧室加被、户外野餐等多种场景。";

const SHERPA_BASE_DESC =
  "SUNNY Sherpa 双面毛毯，一面是柔滑法兰绒、另一面是蓬松羊羔绒（Sherpa），双层设计锁温效果极佳。冬季寒夜也能保持温暖舒适，是全季通用的高品质毯子。";

const FLANNEL_FEATURES = [
  "超柔软合成纤维面料",
  "抗起球处理",
  "轻薄透气",
  "可机洗、易打理",
  "多场景通用",
];

const SHERPA_FEATURES = [
  "双面设计：法兰绒 + 羊羔绒",
  "双层锁温、冬季保暖",
  "超柔软触感",
  "抗起球处理",
  "可机洗、易打理",
  "多尺寸可选",
];

interface ColorEntry {
  color: string;
  nameCn: string;
  category: "plaid" | "solid" | "christmas";
}

const COLORS: ColorEntry[] = [
  { color: "BlackChecker", nameCn: "经典黑色格子", category: "plaid" },
  { color: "BluePlaid", nameCn: "经典蓝色格子", category: "plaid" },
  { color: "RedPlaid", nameCn: "经典红色格子", category: "plaid" },
  { color: "GreyPlaid", nameCn: "经典灰色格子", category: "plaid" },
  { color: "Naviblue", nameCn: "海军蓝", category: "solid" },
  { color: "Tealblue", nameCn: "青蓝色", category: "solid" },
  { color: "Pastel Lilac", nameCn: "粉紫色", category: "solid" },
  { color: "Frozenberry", nameCn: "冰莓色", category: "solid" },
  { color: "Meteorite Grey", nameCn: "陨石灰", category: "solid" },
  { color: "Smoke Grey", nameCn: "烟灰色", category: "solid" },
  { color: "Black COCO", nameCn: "可可黑", category: "solid" },
  { color: "Coconut Cream", nameCn: "椰奶白", category: "solid" },
  { color: "Snowflake", nameCn: "雪花图案（圣诞限定）", category: "christmas" },
  { color: "Reindeer", nameCn: "驯鹿图案（圣诞限定）", category: "christmas" },
];

async function main() {
  console.log("Seeding ProductCatalog...");

  const products = [];

  for (const c of COLORS) {
    products.push({
      name: `法兰绒毛毯 - ${c.nameCn}`,
      productLine: "flannel",
      color: c.color,
      description: FLANNEL_BASE_DESC,
      features: FLANNEL_FEATURES,
      sizes: SIZES_LIGHT,
      isActive: true,
    });

    products.push({
      name: `Sherpa双面毛毯 - ${c.nameCn}`,
      productLine: "sherpa",
      color: c.color,
      description: SHERPA_BASE_DESC,
      features: SHERPA_FEATURES,
      sizes: SIZES_SHERPA,
      isActive: true,
    });
  }

  for (const p of products) {
    await prisma.productCatalog.upsert({
      where: {
        id: `seed_${p.productLine}_${p.color.replace(/\s+/g, "_").toLowerCase()}`,
      },
      update: { ...p, sizes: JSON.parse(JSON.stringify(p.sizes)) },
      create: {
        id: `seed_${p.productLine}_${p.color.replace(/\s+/g, "_").toLowerCase()}`,
        ...p,
        sizes: JSON.parse(JSON.stringify(p.sizes)),
      },
    });
  }

  console.log(`Seeded ${products.length} products.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
