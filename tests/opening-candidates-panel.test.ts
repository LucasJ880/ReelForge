import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  StoryboardWorkflowPanel,
  type StoryboardFrameView,
  type StoryboardRunView,
} from "../src/components/video-generation/storyboard-workflow-panel";

/**
 * 开场画面两张里挑一张（2026-11-17）的面板：两张并排、画好的能选；选定之后只剩一张——
 * 留下的可能是第 2 张候选（序号 1），面板要照样把它画出来（真机验证时按序号去找，画成了一个空的「正在绘制」）。
 */

const DIRECTOR = {
  logline: "A hand sinks into a plush blanket.",
  genre: "fmcg" as const,
  productType: "soft",
  scenario: null,
  shots: [
    { index: 1, fromSec: 0, toSec: 2, action: "A hand presses in.", note: "手按进毯面", line: "摸一下就回不去！" },
    { index: 2, fromSec: 2, toSec: 15, action: "The blanket is shaken open.", note: "把毯子抖开", line: null },
  ],
};

function frame(overrides: Partial<StoryboardFrameView>): StoryboardFrameView {
  return {
    id: "f0",
    ordinal: 0,
    attempt: 1,
    beat: "opening frame · the moment before the action starts",
    prompt: "prompt",
    status: "SUCCEEDED",
    imageUrl: "https://blob.example/opening-0.png",
    errorCode: null,
    errorMessage: null,
    canRegenerate: true,
    waitedSec: null,
    ...overrides,
  };
}

function render(run: Partial<StoryboardRunView>): string {
  return renderToStaticMarkup(React.createElement(StoryboardWorkflowPanel, {
    run: {
      id: "run-1",
      status: "GENERATING",
      approvalPolicy: "MANUAL",
      durationSec: 15,
      aspectRatio: "9:16",
      approvedAt: null,
      errorCode: null,
      errorMessage: null,
      canApprove: true,
      director: DIRECTOR,
      openingCandidates: 2,
      frames: [],
      ...run,
    } as StoryboardRunView,
    english: false,
    busyFrameId: null,
    approving: false,
    onRegenerate: () => undefined,
    onApprove: () => undefined,
    onEditPlan: () => undefined,
  }));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

test("两张候选：一张画好一张在画 → 两格都在，画好的那张默认选中、可以直接确认", () => {
  const html = render({
    frames: [
      frame({ id: "f0", ordinal: 0 }),
      frame({ id: "f1", ordinal: 1, status: "PROCESSING", imageUrl: null, canRegenerate: false, waitedSec: 40 }),
    ],
  });
  assert.equal(count(html, 'data-testid="opening-candidate"'), 2);
  assert.equal(count(html, 'data-chosen="true"'), 1);
  assert.match(html, /一张开场画面已经画好，另一张还在画/);
  assert.match(html, /已选这一张/);
  assert.match(html, /开场画面 · 候选 2/);
  /// 确认按钮没有被禁用（还在 GENERATING 也能确认）
  const approve = html.slice(html.lastIndexOf("<button"), html.lastIndexOf("确认开场画面和脚本"));
  assert.doesNotMatch(approve, /disabled=""/);
});

test("两张候选：一张都没画好 → 不能选、不能确认", () => {
  const html = render({
    canApprove: false,
    frames: [
      frame({ id: "f0", ordinal: 0, status: "PROCESSING", imageUrl: null }),
      frame({ id: "f1", ordinal: 1, status: "QUEUED", imageUrl: null }),
    ],
  });
  assert.equal(count(html, 'data-chosen="true"'), 0);
  assert.match(html, /两张开场画面正在画、供你挑一张/);
  const approve = html.slice(html.lastIndexOf("<button"), html.lastIndexOf("确认开场画面和脚本"));
  assert.match(approve, /disabled=""/);
});

test("选定之后只剩一张：留下的是第 2 张候选（序号 1）也照样画出来，不出现空的「正在绘制」", () => {
  const html = render({
    status: "APPROVED",
    canApprove: false,
    openingCandidates: 1,
    frames: [frame({ id: "f1", ordinal: 1, imageUrl: "https://blob.example/opening-1.png" })],
  });
  assert.match(html, /https:\/\/blob\.example\/opening-1\.png/);
  assert.doesNotMatch(html, /正在绘制此分镜|正在画这一张|排队中/);
  assert.equal(count(html, 'data-testid="opening-candidate"'), 0, "选定之后不再是挑选状态");
  assert.match(html, /故事板已确认/);
  assert.match(html, /1\/1/);
});

test("11-17 之前的轮次（响应里没有候选张数）：按一张开场画面显示", () => {
  const html = render({ status: "AWAITING_APPROVAL", openingCandidates: undefined, frames: [frame({})] });
  assert.equal(count(html, 'data-testid="opening-candidate"'), 0);
  assert.match(html, /成片从这一帧开始/);
});
