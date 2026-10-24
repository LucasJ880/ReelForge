/**
 * 多分组批量提交（混合批量队列 → 每组一个批次）的幂等键规则（1025 · 1.3）。
 *
 * - 每个分组各自一把稳定的幂等键，按分组 id 记；分组内容（请求体）变了才换新键。
 * - 分组建成后调用方把它出队并丢掉它的键，再点提交只会提交剩下的分组。
 * - 失败的分组保留原键重放：服务端若其实已建好就 replay 同一个批次；
 *   额度不足被取消的批次已在服务端释放了键，重放会新建而不是 replay 死批次。
 *
 * 纯逻辑，不碰 fetch / React，客户端组件可以直接引用。
 */

export type GroupSubmissionKeys = Map<string, { fingerprint: string; key: string }>;

export function groupSubmissionKey(
  keys: GroupSubmissionKeys,
  groupId: string,
  fingerprint: string,
  mintKey: () => string = () => crypto.randomUUID(),
): string {
  const existing = keys.get(groupId);
  if (existing?.fingerprint === fingerprint) return existing.key;
  const key = mintKey();
  keys.set(groupId, { fingerprint, key });
  return key;
}
