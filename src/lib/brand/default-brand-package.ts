/**
 * 创作页默认片尾（2026-10-28 闭环轮 E2E：商家在上手流程里建好了品牌包，进创作页却默认「只生成干净视频」，
 * 不留意就出一条没有 logo 和联系方式的成片）。有默认品牌包就选它；只有一个品牌包就选那一个；
 * 多个且没有默认才留空让商家自己挑。
 */
export function defaultBrandPackageId(packages: ReadonlyArray<{ id: string; isDefault: boolean }>): string | null {
  return packages.find((item) => item.isDefault)?.id ?? (packages.length === 1 ? packages[0]!.id : null);
}
