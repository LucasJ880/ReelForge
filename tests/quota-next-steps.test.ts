import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageResource } from "@prisma/client";
import { QuotaNextSteps } from "../src/components/quota/quota-next-steps";
import {
  batchCreateErrorMessage,
  customerDirectDispatchMessage,
  dispatchRecoveryHint,
} from "../src/lib/api/customer-video-dispatch-recovery";
import { DEFAULT_CONTACT_EMAIL } from "../src/lib/config/contact";
import {
  PILOT_APPLY_HREF,
  quotaContactHref,
  quotaNextStepsSentence,
} from "../src/lib/quota-next-steps";
import { QuotaExceededError, userMessageForQuota } from "../src/lib/services/quota-service";

/**
 * 2026-10-25 审计 A7：额度用完是死路——服务端叫人去已下线的「用量与账单」（重定向到创作页），
 * 试用账号只剩「下月再试」，结账接口没有界面。现在额度用完的每一处都给两条真能走的路：
 * 申请陪跑试点（/#pilot-apply）与联系我们（contactEmail()，服务端取值、以 props 传给客户端）。
 */

const DEAD_ENDS = /用量与账单|下月再试|升级套餐|账户负责人|upgrade the plan|account owner/;
const NO_ENV = {} as NodeJS.ProcessEnv;

test("视频额度用完：写事实 + 申请陪跑试点 + 联系邮箱，不再指向已下线的用量页", () => {
  const message = userMessageForQuota("VIDEO_DISPATCH", NO_ENV);
  assert.match(message, /^本月视频生成次数已用完。/);
  assert.match(message, /申请陪跑试点（\/#pilot-apply）/);
  assert.ok(message.includes(DEFAULT_CONTACT_EMAIL), "默认写对外联系邮箱");
  assert.doesNotMatch(message, DEAD_ENDS);
});

test("联系邮箱跟着 contactEmail()：环境变量覆盖时写覆盖后的地址", () => {
  const message = userMessageForQuota("VIDEO_DISPATCH", { AIVORA_CONTACT_EMAIL: "pilot@aivora.test" } as unknown as NodeJS.ProcessEnv);
  assert.ok(message.includes("pilot@aivora.test"));
  assert.ok(!message.includes(DEFAULT_CONTACT_EMAIL));
});

test("所有会卡死出片的额度都给下一步；方案预览本来就有「直接生成」这条路", () => {
  const resources: UsageResource[] = ["VIDEO_DISPATCH", "SEEDANCE_SEGMENT", "BLOB_UPLOAD_BYTES", "DIGITAL_HUMAN_AD"];
  for (const resource of resources) {
    const message = userMessageForQuota(resource, NO_ENV);
    assert.match(message, /申请陪跑试点/, resource);
    assert.doesNotMatch(message, DEAD_ENDS, resource);
  }
  assert.match(userMessageForQuota("PLAN_PREVIEW", NO_ENV), /直接生成/);
  /// 抛出去的错误就是这句（API 的 error 字段原样带给客户）
  const error = new QuotaExceededError({ resource: "VIDEO_DISPATCH", used: 3, limit: 3, periodKey: "2026-10" });
  assert.equal(error.message, userMessageForQuota("VIDEO_DISPATCH"));
});

test("客户端恢复提示（view_usage）中英双语给下一步，不再叫人找账户负责人 / 升级套餐", () => {
  const zh = dispatchRecoveryHint("view_usage", "zh-CN");
  const en = dispatchRecoveryHint("view_usage", "en-US");
  assert.equal(zh, "想继续出片：在首页申请陪跑试点（/#pilot-apply），或联系我们。");
  assert.match(en, /apply for the guided pilot on our homepage \(\/#pilot-apply\) or contact us/);
  for (const hint of [zh, en]) assert.doesNotMatch(hint, DEAD_ENDS);
});

test("单条派发撞上额度：事实 + 下一步；批量向导中文沿用服务端那句（带邮箱），英文只写事实", () => {
  assert.equal(
    customerDirectDispatchMessage({ code: "QUOTA_EXCEEDED", action: "view_usage" }, "zh-CN"),
    "本月视频额度已用完。 想继续出片：在首页申请陪跑试点（/#pilot-apply），或联系我们。",
  );
  assert.match(
    customerDirectDispatchMessage({ code: "QUOTA_EXCEEDED", action: "view_usage" }, "en-US"),
    /^This month's video allowance is used up\. To keep producing/,
  );
  const server = userMessageForQuota("VIDEO_DISPATCH", NO_ENV);
  assert.equal(batchCreateErrorMessage("QUOTA_EXCEEDED", "zh-CN", server), server);
  assert.equal(batchCreateErrorMessage("QUOTA_EXCEEDED", "en-US", server), "This month's video allowance can't cover this batch.");
  assert.equal(batchCreateErrorMessage("QUOTA_EXCEEDED", "zh-CN"), "本月视频额度不够创建这一批。");
});

test("纯文本下一步：有邮箱写邮箱，没有就只写「联系我们」，不猜地址", () => {
  assert.equal(
    quotaNextStepsSentence("zh-CN", " founder@aivora.test "),
    "想继续出片：在首页申请陪跑试点（/#pilot-apply），或写信联系我们：founder@aivora.test。",
  );
  assert.equal(quotaNextStepsSentence("zh-CN", null), "想继续出片：在首页申请陪跑试点（/#pilot-apply），或联系我们。");
  assert.match(quotaNextStepsSentence("en-US", "founder@aivora.test"), /or email us at founder@aivora\.test\.$/);
  assert.equal(PILOT_APPLY_HREF, "/#pilot-apply");
  assert.equal(
    quotaContactHref("founder@aivora.test", "zh-CN"),
    `mailto:founder@aivora.test?subject=${encodeURIComponent("Aivora · 本月额度已用完")}`,
  );
});

test("入口组件：申请陪跑试点链到首页试点表单；有邮箱才出「联系我们」", () => {
  const withEmail = renderToStaticMarkup(
    React.createElement(QuotaNextSteps, { locale: "zh-CN", contactEmail: "founder@aivora.test" }),
  );
  assert.match(withEmail, /href="\/#pilot-apply"/);
  assert.match(withEmail, />申请陪跑试点</);
  assert.match(withEmail, /href="mailto:founder@aivora\.test\?subject=/);
  assert.match(withEmail, /联系我们/);

  const english = renderToStaticMarkup(
    React.createElement(QuotaNextSteps, { locale: "en-US", contactEmail: "founder@aivora.test" }),
  );
  assert.match(english, />Apply for the guided pilot</);
  assert.match(english, /Contact us/);

  const withoutEmail = renderToStaticMarkup(React.createElement(QuotaNextSteps, { locale: "zh-CN" }));
  assert.match(withoutEmail, /href="\/#pilot-apply"/);
  assert.doesNotMatch(withoutEmail, /mailto:/);
});

test("接线：邮箱只在服务端页面取、以 props 传下去；额度用完的每一处客户端界面都挂上入口", async () => {
  const read = (file: string) => readFile(file, "utf8");
  const [createPage, batchPage, libraryDetail, studio, monitor, actions] = await Promise.all([
    read("src/app/(platform)/app/create/page.tsx"),
    read("src/app/(platform)/app/batches/[id]/page.tsx"),
    read("src/app/(platform)/app/library/[id]/page.tsx"),
    read("src/components/video-generation/streamlined-video-studio.tsx"),
    read("src/components/batch/batch-monitor.tsx"),
    read("src/components/library/video-actions.tsx"),
  ]);
  for (const page of [createPage, batchPage, libraryDetail]) {
    assert.match(page, /import \{ contactEmail \} from "@\/lib\/config\/contact";/);
    assert.match(page, /contactEmail=\{contactEmail\(\)\}/);
  }
  for (const client of [studio, monitor, actions]) {
    assert.match(client, /^"use client";/);
    assert.doesNotMatch(client, /@\/lib\/config\/contact/, "客户端组件不自己读联系邮箱");
    assert.match(client, /<QuotaNextSteps locale=\{[^}]+\} contactEmail=\{contactEmail\}/);
  }
  assert.match(studio, /setQuotaError\(payload\.code === "QUOTA_EXCEEDED" \? message : null\);/);
  assert.match(studio, /readings\.quotaUsed >= readings\.quotaLimit/, "额度已用完时提交前就给下一步");
  assert.match(monitor, /errorAction === "view_usage"/);
  assert.match(actions, /body\?\.code === "QUOTA_EXCEEDED"/);
});
