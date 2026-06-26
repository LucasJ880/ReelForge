/**
 * OmniHuman 连通性自检（不消耗生成额度、不需要图/音素材）
 * ==================================================================
 *
 * 用你 .env.local 里的火山 AK/SK + req_key 向「智能视觉服务」发一次轻量查询
 * （CVSync2AsyncGetResult，查一个不存在的 task_id），据返回判断：
 *   - 鉴权（AK/SK 签名）是否通过
 *   - req_key（OmniHuman 算法名）是否有效 / 是否已开通
 *
 * 用法：npm run omnihuman:ping
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import {
  getOmniHumanStatus,
  isOmniHumanConfigured,
} from "../src/lib/providers/omnihuman";

async function main() {
  console.log("\n=== OmniHuman 连通性自检 ===\n");

  if (!isOmniHumanConfigured()) {
    console.error(
      "❌ 缺少火山 AK/SK：请在 .env.local 配置 " +
        "VOLCENGINE_ACCESS_KEY_ID 与 VOLCENGINE_SECRET_ACCESS_KEY。",
    );
    process.exit(1);
  }

  const reqKey = process.env.VOLC_OMNIHUMAN_REQ_KEY?.trim() || "(默认 realman_avatar_picture_omni_v2)";
  console.log(`· AK/SK：已配置`);
  console.log(`· req_key：${reqKey}`);
  console.log(`· 正在向 visual.volcengineapi.com 发探测请求...\n`);

  try {
    const r = await getOmniHumanStatus("ping-nonexistent-task-0000");
    /// 没抛错 = 签名通过 + req_key 被算法层接受（任务不存在属正常返回）。
    console.log("✅ 鉴权通过，且 req_key 有效。");
    console.log(`   （探测任务的 Provider 状态：${r.rawProviderStatus || r.status}，` +
      `任务不存在是预期结果，说明密钥与 req_key 都没问题。）`);
    console.log("\n下一步：可以放心跑 npm run demo:omnihuman 出片了。");
  } catch (err) {
    const m = (err as Error).message || "";
    console.error("探测失败，原始错误：\n  " + m + "\n");
    if (/sign|signature|credential|accesskey|access key|auth|鉴权|签名|denied|InvalidAccessKey|AuthFailure|403/i.test(m)) {
      console.error(
        "→ 判定：❌ AK/SK 鉴权问题。请检查：\n" +
          "   1) VOLCENGINE_ACCESS_KEY_ID / VOLCENGINE_SECRET_ACCESS_KEY 是否填对（无多余空格/换行）；\n" +
          "   2) 该账号是否已实名认证；\n" +
          "   3) 子账号是否被授予了视觉服务（CV）权限。",
      );
    } else if (/req_key|algorithm|算法|not.*(open|enabled)|未开通|no permission|权限|product/i.test(m)) {
      console.error(
        "→ 判定：❌ req_key 无效或 OmniHuman 未开通。请检查：\n" +
          "   1) 在控制台「智能视觉服务 → OmniHuman → 调用步骤2:视频生成」核对 req_key 固定值；\n" +
          "   2) 是否已申请/开通 OmniHuman 能力；\n" +
          "   3) 用核对到的值覆盖 .env.local 的 VOLC_OMNIHUMAN_REQ_KEY。",
      );
    } else {
      console.error(
        "→ 无法自动归类。可能是网络、计费额度或返回结构问题；把上面原始错误发我，我来判断。",
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("自检脚本异常：", (err as Error).message);
  process.exit(1);
});
