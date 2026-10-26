/**
 * 演练库门禁（X-SCAF-5）。
 *
 * 会写库的演练脚本（phase5a 容量压测等）在连库之前必须过这道门：
 *   - `DATABASE_URL` 必须指向 `NEON_REHEARSAL_DATABASE_URL` 所在的 Neon 端点；
 *   - 且不能是 `NEON_PRODUCTION_OWNER_DATABASE_URL` 所在的端点；
 *   - 三个 env 缺任何一个都拒绝——没有生产库坐标就无法证明「不是生产库」。
 *
 * 旧写法只看 host 是否含 `us-east-1.aws.neon.tech`，生产库与演练库都在那个区域，
 * 等于没拦。这里按 Neon 端点身份比对：主机名第一段去掉 `-pooler` 后缀
 * （`ep-xxx-pooler.…` 与 `ep-xxx.…` 是同一个分支的两个入口），所以 pooler 版的生产
 * 连接串也会被认出来并拒绝。
 *
 * 纯函数：不读 process.env、不连库，便于单测。错误信息只带主机名，不带账号口令。
 */

export interface RehearsalGuardInput {
  /** 进程当前要用的库（脚本调用方显式指定，表示「我要跑演练」）。 */
  databaseUrl: string | undefined;
  /** 演练分支的连接串（NEON_REHEARSAL_DATABASE_URL）。 */
  rehearsalUrl: string | undefined;
  /** 生产 owner 连接串（NEON_PRODUCTION_OWNER_DATABASE_URL），只用来认出生产端点。 */
  productionOwnerUrl: string | undefined;
}

export interface RehearsalDatabase {
  /** 演练库连接串（脚本应当用它显式构造 Prisma client，而不是依赖进程 env）。 */
  url: string;
  /** 演练库主机名（可写进证据 JSON，不含口令）。 */
  host: string;
  /** Neon 端点身份（去掉 -pooler 后的主机名）。 */
  endpoint: string;
}

export class RehearsalGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RehearsalGuardError";
  }
}

function hostOf(url: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RehearsalGuardError(`${label} 不是合法的连接串，拒绝运行`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) throw new RehearsalGuardError(`${label} 没有主机名，拒绝运行`);
  return host;
}

/** Neon 端点身份：`ep-foo-pooler.us-east-1.aws.neon.tech` → `ep-foo.us-east-1.aws.neon.tech`。 */
export function neonEndpointOf(host: string): string {
  const [first, ...rest] = host.toLowerCase().split(".");
  return [first.replace(/-pooler$/, ""), ...rest].join(".");
}

/**
 * 通过返回演练库坐标；不通过抛 RehearsalGuardError（调用方应直接退出，不要兜底）。
 */
export function assertRehearsalDatabase(input: RehearsalGuardInput): RehearsalDatabase {
  if (!input.rehearsalUrl) {
    throw new RehearsalGuardError("NEON_REHEARSAL_DATABASE_URL 未设置：没有演练库坐标，拒绝运行");
  }
  if (!input.productionOwnerUrl) {
    throw new RehearsalGuardError(
      "NEON_PRODUCTION_OWNER_DATABASE_URL 未设置：没有生产库坐标就无法证明不是生产库，拒绝运行",
    );
  }
  if (!input.databaseUrl) {
    throw new RehearsalGuardError(
      "DATABASE_URL 未设置：演练脚本要求调用方显式把 DATABASE_URL 指到演练库，拒绝运行",
    );
  }

  const rehearsalHost = hostOf(input.rehearsalUrl, "NEON_REHEARSAL_DATABASE_URL");
  const productionHost = hostOf(input.productionOwnerUrl, "NEON_PRODUCTION_OWNER_DATABASE_URL");
  const databaseHost = hostOf(input.databaseUrl, "DATABASE_URL");

  const rehearsalEndpoint = neonEndpointOf(rehearsalHost);
  const productionEndpoint = neonEndpointOf(productionHost);
  const databaseEndpoint = neonEndpointOf(databaseHost);

  if (rehearsalEndpoint === productionEndpoint) {
    throw new RehearsalGuardError(
      `演练库与生产库是同一个端点（${rehearsalEndpoint}）：env 配置有误，拒绝运行`,
    );
  }
  if (databaseEndpoint === productionEndpoint) {
    throw new RehearsalGuardError(`DATABASE_URL 指向生产库端点（${databaseHost}），拒绝运行`);
  }
  if (databaseEndpoint !== rehearsalEndpoint) {
    throw new RehearsalGuardError(
      `DATABASE_URL 的主机（${databaseHost}）不是演练库（${rehearsalHost}），拒绝运行`,
    );
  }

  return { url: input.rehearsalUrl, host: rehearsalHost, endpoint: rehearsalEndpoint };
}
