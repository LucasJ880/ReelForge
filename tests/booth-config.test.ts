import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_CONTACT_EMAIL } from "../src/lib/config/contact";

/**
 * 2026-10-25 审计 C9：广交会展台套件 config.json 三项开展前必填的空着；展台文案说 IG/FB 评论「试点中」，
 * 实际没有任何评论接入。锁住：resultBase = 仓库里通用的生产地址、leadFallback = 对外联系邮箱、
 * 法律主体没填时界面写明「待填」而不是留空、渠道只写真实状态。
 */

const BOOTH = "designs/aivora-v2-exchange/booth";
type BoothConfig = {
  resultBase: string;
  leadFallback: { email: string; whatsapp: string; wechat: string };
  consentEntity: { name: string; address: string; email: string };
  channels: Record<"live" | "pending" | "roadmap", Array<{ en: string; zh: string }>>;
};

async function config(): Promise<BoothConfig> {
  return JSON.parse(await readFile(`${BOOTH}/config.json`, "utf8")) as BoothConfig;
}

test("resultBase 是仓库里通用的生产地址；访客提交失败时给对外联系邮箱", async () => {
  const cfg = await config();
  assert.equal(cfg.resultBase, "https://reelforge-delta.vercel.app");
  const integration = await readFile("docs/integrations/qingyan-aivora-sync.md", "utf8");
  assert.ok(integration.includes(`| Base URL | \`${cfg.resultBase}\` |`), "与青砚对接文档里的生产 Base URL 一致");
  assert.equal(cfg.leadFallback.email, DEFAULT_CONTACT_EMAIL);
});

test("渠道只写真实状态：Instagram / Facebook 评论没有接入，不能挂在「试点中」", async () => {
  const cfg = await config();
  for (const item of cfg.channels.live) {
    assert.doesNotMatch(`${item.en} ${item.zh}`, /instagram|facebook|\bIG\b|\bFB\b/i, JSON.stringify(item));
  }
  assert.ok(cfg.channels.roadmap.some((item) => /IG \/ FB comments/.test(item.en)), "评论接入列在「规划中 · 未上线」");
  const booth = await readFile(`${BOOTH}/booth.js`, "utf8");
  assert.doesNotMatch(booth, /Our pilot runs on the official Instagram \/ Facebook API/);
  assert.doesNotMatch(booth, /我们的试点走 Instagram \/ Facebook 官方接口/);
  assert.doesNotMatch(booth, /Instagram 与 Facebook 评论（试点中）/);
});

test("法律主体没填：设置页写明「待填」、店主台递二维码前提醒，不留空白", async () => {
  const cfg = await config();
  const index = await readFile(`${BOOTH}/index.html`, "utf8");
  assert.match(index, /<code id="entity" class="sel"><\/code>/);
  assert.match(index, /【待填】法律主体名称 \+ 邮箱（config\.json → consentEntity）/);
  const owner = await readFile(`${BOOTH}/owner.js`, "utf8");
  assert.match(owner, /noEntity\(\) \? `<span class="o-warn" role="note">/);
  const booth = await readFile(`${BOOTH}/booth.js`, "utf8");
  assert.match(booth, /o_noEntity: "config\.json 还没填征求同意的法律主体/);
  /// 现状：主体还没填（等创始人给法律主体）；填了之后这条自然不成立，不是要它一直空着
  if (!cfg.consentEntity.name || !cfg.consentEntity.email) {
    const result = await readFile(`${BOOTH}/result.html`, "utf8");
    assert.match(result, /e\.name && e\.email \? e : null/, "主体不全时结果页不收同意、只给联系方式");
  }
});
