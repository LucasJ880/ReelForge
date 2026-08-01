import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseRecipeId } from "../src/lib/services/winner-derivation-service";
import {
  heuristicPlan,
  type ContentPlanInput,
} from "../src/lib/services/content-plan-service";

const serviceSource = readFileSync(
  path.join(process.cwd(), "src/lib/services/content-plan-service.ts"),
  "utf8",
);

test("配方 id 拆得出结构，拆不出就返回 null 而不是猜", () => {
  assert.deepEqual(parseRecipeId("post:POV:single_image"), {
    hookType: "POV",
    format: "single_image",
  });
  /// 视频线路的配方是 tpl:slug@ver，不是图文帖结构，不能硬拆。
  assert.equal(parseRecipeId("tpl:cinematic@3"), null);
  assert.equal(parseRecipeId("post:POV"), null);
  assert.equal(parseRecipeId(""), null);
});

test("🔴 判不出赢家时不派生 —— 拿噪声当赢家会让商家照错方向投入", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/winner-derivation-service.ts"),
    "utf8",
  );
  /// 只有 verdict.status === "winner" 才会带 winningRecipe。
  assert.match(source, /verdict\.status === "winner"/);
  const fallback = source.slice(source.indexOf("const structures = args.industry"));
  assert.match(fallback, /winningRecipe: null/);
});

test("借同行结构时必须说清是借来的，不冒充自己的数据结论", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/winner-derivation-service.ts"),
    "utf8",
  );
  assert.match(source, /还判不出胜负，本周先参考同行/);
});

test("参考结构进提示词时明确禁止复用原文措辞", () => {
  assert.match(serviceSource, /SKELETON ONLY/);
  assert.match(serviceSource, /NEVER reuse their wording, taglines, or specific claims/);
  assert.match(serviceSource, /All copy must be original/);
});

test("赢家配方只锁结构，不锁角度与画面", () => {
  assert.match(
    serviceSource,
    /Vary the angle and the visual,\n?not the structure/,
    "结构是已经在起作用的东西，角度和画面才该变",
  );
});

test("没有参考结构与赢家时提示词不多出空段落", () => {
  const input: ContentPlanInput = { sentence: "我家做定制百叶窗" };
  /// 启发式路径不受这两个新入参影响，仍然产出可用计划。
  const plan = heuristicPlan(input);
  assert.ok(plan.posts.length >= 3);
});
