import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadFinishingDraft, saveFinishingDraft, type FinishingDraft } from "../src/lib/video-generation/finishing-draft-storage";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const DRAFT: FinishingDraft = {
  cornerLogo: true,
  signoffEnabled: true,
  signoffBrand: "梦馨家纺",
  signoffCta: "源头工厂直供",
  signoffLogo: false,
  captionsEnabled: true,
  captionStyle: "word_by_word",
  captionPosition: "bottom",
  exportSrt: true,
};

test("收尾设置跟描述绑定：描述一致才恢复（勾好的右上角 Logo 刷新后还在），换描述或清除后不恢复", () => {
  const storage = memoryStorage();
  saveFinishingDraft(storage, " 婴儿纱布口水巾 ", DRAFT);
  assert.deepEqual(loadFinishingDraft(storage, "婴儿纱布口水巾"), DRAFT);
  assert.equal(loadFinishingDraft(storage, "毛毯"), null);
  saveFinishingDraft(storage, "婴儿纱布口水巾", null);
  assert.equal(loadFinishingDraft(storage, "婴儿纱布口水巾"), null);
});

test("存储损坏或形状不对时退回缺省值而不是抛错", () => {
  const storage = memoryStorage();
  storage.setItem("aivora.finishing-draft.v1", "{not json");
  assert.equal(loadFinishingDraft(storage, "x"), null);
  storage.setItem("aivora.finishing-draft.v1", JSON.stringify({ prompt: "x", draft: { cornerLogo: true, signoffBrand: 7 } }));
  assert.equal(loadFinishingDraft(storage, "x"), null);
});

test("创作页接线：恢复故事板时还原收尾设置；第一次渲染的缺省值不覆盖已存的；出片成功后清掉", async () => {
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /loadFinishingDraft\(sessionStorage, context\.prompt\)/);
  assert.match(studio, /setCornerLogo\(finishing\.cornerLogo\)/);
  assert.match(studio, /finishingDraftArmedRef\.current = true;\s*return;/);
  assert.match(studio, /saveFinishingDraft\(sessionStorage, rawPrompt, null\)/);
});
