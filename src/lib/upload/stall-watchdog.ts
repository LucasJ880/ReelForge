/**
 * 上传卡住看门狗（2026-11-10）。
 *
 * 浏览器直传对象存储那一步用的是存储方的客户端（@vercel/blob）。它遇到网络错误和 5xx 会**不声不响地重试**，
 * 最多 10 次、间隔成倍拉长，加起来十几分钟——这段时间里既不成功也不报错，商家只看到一直「上传中」。
 * 11-10 发布后冒烟连续两次撞上：取到了上传凭证，之后 120 秒没有任何结果。
 *
 * 判断「卡住」不看有没有进度事件（每次重试都会从头再报一遍进度），看**传到过的最远位置**有没有再往前：
 *  - 一个字节都没传出去，超过 `firstByteMs` → 卡住；
 *  - 最远位置超过 `stallMs` 没有再往前 → 卡住（重试从 0 重新报进度不算往前）。
 * 网速慢但一直在往前传的不受影响：只要最远位置在动，就一直等。
 *
 * 为什么「不往前」要等到两分钟：Chrome 上这个进度数的是**交给浏览器的字节**，不是已经发到网上的字节——
 * 浏览器和系统的发送缓冲能先吞下几 MB。很差的手机网络（上行几十 KB/s）上，进度会很快走到头，
 * 剩下的字节还要一两分钟才真正发完；时限定短了会把这种「慢但会成功」的上传误杀。
 * 两分钟比存储客户端自己重试的十几分钟短得多，又给慢网络留足了余量。
 *
 * 纯逻辑、计时器可注入：测试里不用真等。
 */
export const UPLOAD_FIRST_BYTE_TIMEOUT_MS = 60_000;
export const UPLOAD_STALL_TIMEOUT_MS = 120_000;

export interface StallWatchdogTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface StallWatchdog {
  /** 报一次进度：已经传出去的字节数（存储客户端每次重试会从小的数重新报） */
  progress: (loadedBytes: number) => void;
  /** 传完或失败了，别再盯着 */
  stop: () => void;
}

const defaultTimers: StallWatchdogTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createStallWatchdog({
  onStall,
  firstByteMs = UPLOAD_FIRST_BYTE_TIMEOUT_MS,
  stallMs = UPLOAD_STALL_TIMEOUT_MS,
  timers = defaultTimers,
}: {
  onStall: () => void;
  firstByteMs?: number;
  stallMs?: number;
  timers?: StallWatchdogTimers;
}): StallWatchdog {
  let highWater = 0;
  let stopped = false;
  let handle: unknown = null;

  const arm = (ms: number) => {
    if (handle !== null) timers.clear(handle);
    handle = timers.set(() => {
      handle = null;
      if (stopped) return;
      stopped = true;
      onStall();
    }, ms);
  };

  arm(firstByteMs);

  return {
    progress(loadedBytes) {
      if (stopped || !Number.isFinite(loadedBytes) || loadedBytes <= highWater) return;
      highWater = loadedBytes;
      arm(stallMs);
    },
    stop() {
      stopped = true;
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
  };
}

/**
 * 两个中止信号合成一个：任何一个中止，合成的就中止。有 `AbortSignal.any` 就用它，没有就自己接线。
 * `release` 在用完后调用，把自己接的监听拆掉（`AbortSignal.any` 那条路什么都不用拆）。
 */
export function mergeAbortSignals(signals: Array<AbortSignal | null | undefined>): { signal: AbortSignal; release: () => void } {
  const present = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (present.length === 1) return { signal: present[0], release: () => undefined };
  if (typeof AbortSignal.any === "function") return { signal: AbortSignal.any(present), release: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of present) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    release: () => {
      for (const signal of present) signal.removeEventListener("abort", abort);
    },
  };
}
