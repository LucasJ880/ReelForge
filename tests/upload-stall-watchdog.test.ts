import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  UPLOAD_FIRST_BYTE_TIMEOUT_MS,
  UPLOAD_STALL_TIMEOUT_MS,
  createStallWatchdog,
  mergeAbortSignals,
  type StallWatchdogTimers,
} from "../src/lib/upload/stall-watchdog";

/**
 * 2026-11-10：#66 上线后的冒烟连续两次在「6MB 手机原图直传」卡住——凭证拿到了，之后 120 秒既没传完也没报错。
 * 存储客户端（@vercel/blob）遇到网络错误 / 5xx 会不声不响地重试十几分钟，商家只会一直看到「上传中」。
 * 这里守住：传到过的最远位置太久不往前，就中止并明说卡住了；慢但一直在动的不受影响。
 */

/** 可以手动拨的假时钟 */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: StallWatchdogTimers = {
    set: (callback, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, callback });
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...pending]) {
      if (timer.at <= now) {
        pending.delete(id);
        timer.callback();
      }
    }
  };
  return { timers, advance, pending };
}

test("一个字节都没传出去：到了首字节时限就判卡住，只叫一次", () => {
  const clock = fakeTimers();
  let stalls = 0;
  createStallWatchdog({ onStall: () => stalls++, timers: clock.timers });
  clock.advance(UPLOAD_FIRST_BYTE_TIMEOUT_MS - 1);
  assert.equal(stalls, 0);
  clock.advance(1);
  assert.equal(stalls, 1);
  clock.advance(UPLOAD_FIRST_BYTE_TIMEOUT_MS * 3);
  assert.equal(stalls, 1);
  assert.equal(clock.pending.size, 0);
});

test("慢但一直在往前传：等多久都不判卡住", () => {
  const clock = fakeTimers();
  let stalls = 0;
  const watchdog = createStallWatchdog({ onStall: () => stalls++, timers: clock.timers });
  /// 很快传出第一段，之后每隔「差 5 秒到时限」才往前挪一点，这样拖了将近一小时
  clock.advance(2_000);
  watchdog.progress(100_000);
  for (let step = 1; step <= 30; step += 1) {
    clock.advance(UPLOAD_STALL_TIMEOUT_MS - 5_000);
    watchdog.progress(100_000 + step * 200_000);
  }
  assert.equal(stalls, 0);
  watchdog.stop();
  clock.advance(UPLOAD_STALL_TIMEOUT_MS * 2);
  assert.equal(stalls, 0, "传完之后不再盯着");
  assert.equal(clock.pending.size, 0);
});

test("传到一半不动了：最远位置超过时限没往前就判卡住", () => {
  const clock = fakeTimers();
  let stalls = 0;
  const watchdog = createStallWatchdog({ onStall: () => stalls++, timers: clock.timers });
  watchdog.progress(3_000_000);
  clock.advance(UPLOAD_STALL_TIMEOUT_MS - 1);
  assert.equal(stalls, 0);
  clock.advance(1);
  assert.equal(stalls, 1);
});

test("存储客户端在后台重试（进度从头再报）：不算往前，照样判卡住", () => {
  const clock = fakeTimers();
  let stalls = 0;
  const watchdog = createStallWatchdog({ onStall: () => stalls++, timers: clock.timers });
  /// 第一次把 6MB 都发出去了，服务端回 5xx
  watchdog.progress(2_000_000);
  watchdog.progress(6_000_000);
  /// 之后每 10 秒重试一次，每次又从头报到 6MB：进度事件一直有，但没有比 6MB 更远
  for (let retry = 0; retry < 4; retry += 1) {
    clock.advance(10_000);
    watchdog.progress(1_000_000);
    watchdog.progress(6_000_000);
  }
  assert.equal(stalls, 0, "还没到时限");
  clock.advance(UPLOAD_STALL_TIMEOUT_MS - 40_000);
  assert.equal(stalls, 1, "从第一次传到 6MB 算起，到时限就判卡住");
  /// 判了之后再来的进度不会把它救回来，也不会再叫第二次
  watchdog.progress(7_000_000);
  clock.advance(UPLOAD_STALL_TIMEOUT_MS * 2);
  assert.equal(stalls, 1);
});

test("乱七八糟的进度值不算数", () => {
  const clock = fakeTimers();
  let stalls = 0;
  const watchdog = createStallWatchdog({ onStall: () => stalls++, timers: clock.timers });
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) watchdog.progress(value);
  clock.advance(UPLOAD_FIRST_BYTE_TIMEOUT_MS);
  assert.equal(stalls, 1, "没有真的往前传过，仍按首字节时限判");
});

test("合并中止信号：任何一个中止，合成的就中止；只有一个时原样返回", () => {
  const user = new AbortController();
  const stall = new AbortController();
  assert.equal(mergeAbortSignals([user.signal, undefined]).signal, user.signal);
  const merged = mergeAbortSignals([user.signal, stall.signal]);
  assert.equal(merged.signal.aborted, false);
  stall.abort();
  assert.equal(merged.signal.aborted, true);
  merged.release();
  const second = mergeAbortSignals([user.signal, new AbortController().signal]);
  user.abort();
  assert.equal(second.signal.aborted, true);
  /// 进来时已经中止的
  assert.equal(mergeAbortSignals([user.signal, new AbortController().signal]).signal.aborted, true);
});

test("合并中止信号：没有 AbortSignal.any 的浏览器走自己接线的那条路，用完能拆掉监听", () => {
  const original = AbortSignal.any;
  // @ts-expect-error 模拟旧浏览器
  AbortSignal.any = undefined;
  try {
    const a = new AbortController();
    const b = new AbortController();
    const merged = mergeAbortSignals([a.signal, b.signal]);
    assert.equal(merged.signal.aborted, false);
    b.abort();
    assert.equal(merged.signal.aborted, true);
    const c = new AbortController();
    const d = new AbortController();
    const released = mergeAbortSignals([c.signal, d.signal]);
    released.release();
    c.abort();
    assert.equal(released.signal.aborted, false, "拆掉之后不再跟着中止");
    const already = new AbortController();
    already.abort();
    assert.equal(mergeAbortSignals([already.signal, new AbortController().signal]).signal.aborted, true);
  } finally {
    AbortSignal.any = original;
  }
});

test("接线：直传那一步挂着看门狗；商家取消优先于卡住；卡住有自己的一句话；最后一定收尾", () => {
  const upload = readFileSync("src/lib/upload/blob-xhr.ts", "utf8");
  const direct = upload.slice(upload.indexOf('await import("@vercel/blob/client")'), upload.indexOf("`${endpoint}/complete`"));
  assert.match(direct, /abortSignal: merged\.signal,/);
  assert.match(direct, /onUploadProgress: \(\{ loaded, percentage \}\) => \{\s+watchdog\.progress\(loaded\);/);
  const cancelled = direct.indexOf("if (signal?.aborted) throw abortError();");
  const stalled = direct.indexOf("if (stalled) {");
  assert.ok(cancelled > 0 && cancelled < stalled, "先看是不是商家自己取消的");
  assert.match(direct, /throw new Error\(UPLOAD_STALLED_MESSAGE\);/);
  assert.match(direct, /\} finally \{\s+watchdog\.stop\(\);\s+merged\.release\(\);\s+\}/);
  assert.match(upload, /export const UPLOAD_STALLED_MESSAGE = "上传卡住了，一直没有进展。请检查网络后再试一次";/);
  /// 看门狗是纯逻辑：客户端组件间接引用它，不能带服务端依赖
  const watchdog = readFileSync("src/lib/upload/stall-watchdog.ts", "utf8");
  assert.doesNotMatch(watchdog, /^import /mu);
});
