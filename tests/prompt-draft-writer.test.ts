import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROMPT_DRAFT_SYSTEM_PROMPT, writePromptDraft } from "../src/lib/video-generation/prompt-draft-writer";

/**
 * 「帮我写 / 帮我润色」（2026-10-28 晚，上线审核 §3，回应 CEO「没有自动生成提示词」）：
 * 看商品图写两三句给人看的描述；失败一律返回 null，界面保留商家原来的字。
 */

type VisionCall = { imageUrls: string[]; system: string; user: string };

function fakeVision(description: unknown, calls: VisionCall[] = []) {
  return (async (imageUrls: string[], system: string, user: string) => {
    calls.push({ imageUrls, system, user });
    return { data: { description }, modelUsed: "fake", tokenUsage: null, raw: "" };
  }) as never;
}

test("看图写：只送 https 商品图（最多 4 张），带上商家已写的字与语言，返回去掉多余空白的描述", async () => {
  const calls: VisionCall[] = [];
  const description = await writePromptDraft(
    {
      imageUrls: ["https://blob.example/a.png", "http://insecure.example/b.png", "https://blob.example/a.png", "https://blob.example/c.png"],
      hint: "  保温杯  通勤 ",
      language: "zh-CN",
      durationSec: 15,
    },
    { llmAvailable: () => true, vision: fakeVision("  清晨地铁站，上班族拿出 NORDA 随行杯喝一口热咖啡；\n到办公室放在桌上，热气还在。 ", calls) },
  );
  assert.equal(description, "清晨地铁站，上班族拿出 NORDA 随行杯喝一口热咖啡； 到办公室放在桌上，热气还在。");
  assert.deepEqual(calls[0]!.imageUrls, ["https://blob.example/a.png", "https://blob.example/c.png"]);
  assert.match(calls[0]!.user, /Simplified Chinese/);
  assert.match(calls[0]!.user, /What the owner already wrote: 保温杯 通勤/);
  assert.equal(calls[0]!.system, PROMPT_DRAFT_SYSTEM_PROMPT);
  assert.match(PROMPT_DRAFT_SYSTEM_PROMPT, /Never invent prices/);
  assert.match(PROMPT_DRAFT_SYSTEM_PROMPT, /brand name or logo is printed on the product, mention it exactly as printed/);
});

test("没图也没字、AI 不可用、超长、超时、抛错：都返回 null（保留商家原来的字）", async () => {
  const base = { imageUrls: ["https://blob.example/a.png"], language: "zh-CN", durationSec: 15 };
  assert.equal(await writePromptDraft({ ...base, imageUrls: [], hint: "  " }, { llmAvailable: () => true, vision: fakeVision("x") }), null);
  assert.equal(await writePromptDraft(base, { llmAvailable: () => false, vision: fakeVision("x") }), null);
  assert.equal(await writePromptDraft(base, { llmAvailable: () => true, vision: fakeVision("长".repeat(400)) }), null);
  assert.equal(await writePromptDraft(base, { llmAvailable: () => true, vision: fakeVision(42) }), null);
  const slow = (async () => new Promise(() => undefined)) as never;
  assert.equal(await writePromptDraft(base, { llmAvailable: () => true, vision: slow, timeoutMs: 20 }), null);
  const broken = (async () => {
    throw new Error("vision down");
  }) as never;
  assert.equal(await writePromptDraft(base, { llmAvailable: () => true, vision: broken }), null);
});

test("接口：只收素材 id、按属主解析图片地址；不扣额度、不触发生成", async () => {
  const route = await readFile("src/app/api/video-generation/prompt-draft/route.ts", "utf8");
  assert.match(route, /requireUserOfTypeForGeneration\(\)/);
  assert.match(route, /resolveOwnedImageAssets\(\{ userId: guard\.session\.user\.id, assetIds: parsed\.data\.assetIds \}\)/);
  assert.doesNotMatch(route, /imageUrls: z\./);
  assert.doesNotMatch(route, /reserveVideoQuota|dispatch/);
});
