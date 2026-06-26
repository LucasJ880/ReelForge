/**
 * 数字人探店广告 · 预置虚拟人形象目录
 * ==================================================================
 *
 * 这些是火山方舟「虚拟人像库」里**预置的、免认证、合规**的虚拟模特资产，
 * 用 `asset://asset-xxx` 形式喂给 Seedance 2.0 的 reference 模式，可规避真人
 * 隐私过滤，并保证模特跨镜头身份一致。
 *
 * 运维如何扩充：
 *   1. 火山方舟控制台 →「系统管理 / 开通管理 / 管理资产」→ 虚拟人像库挑一个，
 *      或在「真人人像资产」里登记一个已授权形象，拿到 assetId（asset-xxxxx）。
 *   2. 在下面 `AVATARS` 里加一条（assetUri 填 `asset://<assetId>`）。
 *   3. thumbnailUrl 指向一张该形象的预览图（可上传到 Blob 后填公网 URL；
 *      留空则前端用首字母占位卡片）。
 *
 * 注意：assetUri 必须属于本项目所用火山账号下「已授权 / 已开通素材库」的资产，
 * 否则 Seedance 提交会报 InvalidParameter / not activated。
 */

export interface DigitalHumanAvatar {
  /// 稳定 id（前端选择 / DB 存储用，不要复用 assetId 以便将来换底层资产）
  id: string;
  /// 展示名
  name: string;
  /// 火山资产引用：asset://asset-xxxxx
  assetUri: string;
  /// 预览缩略图公网 URL；留空则前端用占位卡片
  thumbnailUrl?: string | null;
  /// 性别 / 风格标签，供前端筛选与展示
  gender?: "female" | "male";
  style?: string;
  /// 一句话描述
  description?: string;
}

/**
 * MVP 预置目录。
 *
 * 当前仅内置 1 个已实测可用的虚拟模特（已验证：asset 虚拟人 + 门店图 → Seedance 2.0
 * reference 出片成功）。运维按上面的说明补充更多即可，无需改其它代码。
 */
export const AVATARS: DigitalHumanAvatar[] = [
  {
    id: "ava-qingxin-girl",
    name: "清新女生 · 小诺",
    assetUri:
      process.env.STORE_AD_MODEL_ASSET
        ? process.env.STORE_AD_MODEL_ASSET.startsWith("asset://")
          ? process.env.STORE_AD_MODEL_ASSET
          : `asset://${process.env.STORE_AD_MODEL_ASSET}`
        : "asset://asset-20260401123823-6d4x2",
    thumbnailUrl: null,
    gender: "female",
    style: "清新探店博主",
    description: "长黑发、气质清新的年轻女生，自然亲切，适合探店 / 种草口播。",
  },
];

export function getAvatarById(id: string): DigitalHumanAvatar | undefined {
  return AVATARS.find((a) => a.id === id);
}

export function listAvatars(): DigitalHumanAvatar[] {
  return AVATARS;
}
