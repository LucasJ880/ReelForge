import test from "node:test";
import assert from "node:assert/strict";
import { loadVoiceoverDraft, saveVoiceoverDraft } from "../src/lib/video-generation/voiceover-draft-storage";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

test("口播稿跟描述绑定：描述一致才恢复，换描述或清除后不恢复", () => {
  const storage = memoryStorage();
  saveVoiceoverDraft(storage, " 卖保温杯的小店 ", "热茶装进陶土橙保温杯。");
  assert.equal(loadVoiceoverDraft(storage, "卖保温杯的小店"), "热茶装进陶土橙保温杯。");
  assert.equal(loadVoiceoverDraft(storage, "卖窗帘的小店"), null);
  saveVoiceoverDraft(storage, "卖保温杯的小店", null);
  assert.equal(loadVoiceoverDraft(storage, "卖保温杯的小店"), null);
});

test("存储损坏时退回模板稿而不是抛错", () => {
  const storage = memoryStorage();
  storage.setItem("aivora.voiceover-draft.v1", "{not json");
  assert.equal(loadVoiceoverDraft(storage, "x"), null);
});
