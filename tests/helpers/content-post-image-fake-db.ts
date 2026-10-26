/**
 * C2 图文帖 Shuyu 出图单测用的内存版 Prisma：只实现 content-post-image-job-service 用到的查询形状。
 *
 * - 每次调用先让出一拍（setImmediate），并发路径会像真库一样交错；
 * - `$queryRaw ... FOR UPDATE` 拿帖子行的互斥锁，直到事务结束才放（`locking: false` 可关掉，做反例）；
 * - `$transaction` 抛错时按撤销日志回滚本事务的写入；
 * - 唯一约束：providerRequestKey、externalTaskId、(postId, slideIndex, attempt)。
 * 不连任何数据库。
 */

export type Row = Record<string, unknown>;

type Undo = Array<() => void>;

interface TxContext {
  undo: Undo;
  releases: Array<() => void>;
  held: Set<string>;
}

export interface FakeHook {
  /** 返回 true 表示这次调用要抛错（只触发一次后自动移除）。 */
  match: (model: string, op: string, args: Row) => boolean;
  error?: Error;
  /** 不抛错、只在匹配到时执行副作用（模拟并发写抢先一步）。 */
  before?: (store: ContentPostImageFakeDb) => void;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function num(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function matchValue(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
  if (typeof condition === "object" && !Array.isArray(condition)) {
    for (const [op, operand] of Object.entries(condition as Row)) {
      switch (op) {
        case "in":
          if (!(operand as unknown[]).includes(value)) return false;
          break;
        case "not":
          if (operand === null ? value === null || value === undefined : matchValue(value, operand)) return false;
          break;
        case "lt":
          if (value === null || value === undefined || !(num(value) < num(operand))) return false;
          break;
        case "lte":
          if (value === null || value === undefined || !(num(value) <= num(operand))) return false;
          break;
        case "gt":
          if (value === null || value === undefined || !(num(value) > num(operand))) return false;
          break;
        case "gte":
          if (value === null || value === undefined || !(num(value) >= num(operand))) return false;
          break;
        case "startsWith":
          if (typeof value !== "string" || !value.startsWith(operand as string)) return false;
          break;
        case "isEmpty":
          if ((Array.isArray(value) && value.length === 0) !== operand) return false;
          break;
        default:
          throw new Error(`fake db: unsupported operator ${op}`);
      }
    }
    return true;
  }
  return value === condition;
}

type Relations = Record<string, (row: Row, condition: Row) => boolean>;

export function matches(row: Row, where: Row | undefined, relations: Relations = {}): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === "AND") {
      if (!(condition as Row[]).every((branch) => matches(row, branch, relations))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(condition as Row[]).some((branch) => matches(row, branch, relations))) return false;
      continue;
    }
    if (key === "NOT") {
      const branches = Array.isArray(condition) ? (condition as Row[]) : [condition as Row];
      if (branches.some((branch) => matches(row, branch, relations))) return false;
      continue;
    }
    if (relations[key]) {
      if (!relations[key](row, condition as Row)) return false;
      continue;
    }
    if (!matchValue(row[key], condition)) return false;
  }
  return true;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Array<Record<string, "asc" | "desc">>;
  return [...rows].sort((a, b) => {
    for (const entry of keys) {
      const [field, direction] = Object.entries(entry)[0]!;
      const left = a[field];
      const right = b[field];
      if (left === right) continue;
      if (left === null || left === undefined) return direction === "asc" ? -1 : 1;
      if (right === null || right === undefined) return direction === "asc" ? 1 : -1;
      const diff = num(left) - num(right);
      if (diff !== 0 && !Number.isNaN(diff)) return direction === "asc" ? diff : -diff;
    }
    return 0;
  });
}

const TASK_DEFAULTS: Row = {
  attempt: 1,
  isCurrent: true,
  status: "QUEUED",
  externalTaskId: null,
  submissionState: "NOT_STARTED",
  provider: "shuyu",
  submitAttempts: 0,
  planId: null,
  modelSnapshot: null,
  resolutionSnapshot: null,
  pointsSnapshot: null,
  outputUrl: null,
  outputAssetId: null,
  leaseOwner: null,
  leaseExpiresAt: null,
  availableAt: null,
  lastProviderStatus: null,
  lastCheckedAt: null,
  pollErrors: 0,
  errorCode: null,
  errorMessage: null,
  submittedAt: null,
  completedAt: null,
};

export class ContentPostImageFakeDb {
  posts: Row[];
  tasks: Row[];
  deletedAssets: string[] = [];
  hooks: FakeHook[] = [];
  locking: boolean;
  private lockTails = new Map<string, Promise<void>>();
  private taskSeq = 0;

  constructor(
    private readonly clock: { now: Date },
    seed: { posts: Row[]; tasks?: Row[]; locking?: boolean },
  ) {
    this.posts = seed.posts;
    this.tasks = (seed.tasks ?? []).map((task) => ({
      ...TASK_DEFAULTS,
      createdAt: clock.now,
      updatedAt: clock.now,
      ...task,
    }));
    this.locking = seed.locking ?? true;
  }

  task(id: string): Row {
    const row = this.tasks.find((task) => task.id === id);
    if (!row) throw new Error(`fake db: no task ${id}`);
    return row;
  }

  post(id = "post-1"): Row {
    const row = this.posts.find((post) => post.id === id);
    if (!row) throw new Error(`fake db: no post ${id}`);
    return row;
  }

  private runHooks(model: string, op: string, args: Row): void {
    const index = this.hooks.findIndex((hook) => hook.match(model, op, args));
    if (index === -1) return;
    const [hook] = this.hooks.splice(index, 1);
    hook!.before?.(this);
    if (hook!.error) throw hook!.error;
  }

  private postRelations(): Relations {
    return {
      plan: (row, condition) => matchValue(row.userId, (condition as { userId?: unknown }).userId),
      imageTasks: (row, condition) => {
        const owned = this.tasks.filter((task) => task.postId === row.id);
        const c = condition as { some?: Row; none?: Row };
        if (c.none) return !owned.some((task) => matches(task, c.none));
        if (c.some) return owned.some((task) => matches(task, c.some));
        throw new Error("fake db: unsupported imageTasks filter");
      },
    };
  }

  private projectPost(row: Row): Row {
    const copy = clone(row);
    copy.plan = { userId: row.userId, user: { disabledAt: row.ownerDisabledAt ?? null } };
    return copy;
  }

  private write(ctx: TxContext | null, row: Row, data: Row): void {
    if (ctx) {
      const before = clone(row);
      ctx.undo.push(() => {
        for (const key of Object.keys(row)) delete row[key];
        Object.assign(row, before);
      });
    }
    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === "object" &&
        !(value instanceof Date) &&
        !Array.isArray(value) &&
        "increment" in (value as Row)
      ) {
        row[key] = num(row[key] ?? 0) + num((value as { increment: number }).increment);
      } else {
        row[key] = value;
      }
    }
  }

  private async acquire(ctx: TxContext, postId: string): Promise<void> {
    if (!this.locking || ctx.held.has(postId)) return;
    const previous = this.lockTails.get(postId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.lockTails.set(postId, previous.then(() => mine));
    await previous;
    ctx.held.add(postId);
    ctx.releases.push(release);
  }

  private delegates(ctx: TxContext | null) {
    const contentPost = {
      findFirst: async (args: { where?: Row }) => {
        await tick();
        this.runHooks("contentPost", "findFirst", args as Row);
        const row = this.posts.find((post) => matches(post, args.where, this.postRelations()));
        return row ? this.projectPost(row) : null;
      },
      findMany: async (args: { where?: Row; orderBy?: unknown; take?: number }) => {
        await tick();
        this.runHooks("contentPost", "findMany", args as Row);
        const rows = sortRows(
          this.posts.filter((post) => matches(post, args.where, this.postRelations())),
          args.orderBy,
        );
        return rows.slice(0, args.take ?? rows.length).map((row) => this.projectPost(row));
      },
      updateMany: async (args: { where?: Row; data: Row }) => {
        await tick();
        this.runHooks("contentPost", "updateMany", args as Row);
        let count = 0;
        for (const post of this.posts) {
          if (matches(post, args.where, this.postRelations())) {
            this.write(ctx, post, { ...args.data, updatedAt: this.clock.now });
            count += 1;
          }
        }
        return { count };
      },
    };
    const contentPostImageTask = {
      findFirst: async (args: { where?: Row; orderBy?: unknown }) => {
        await tick();
        this.runHooks("contentPostImageTask", "findFirst", args as Row);
        const row = sortRows(this.tasks.filter((task) => matches(task, args.where)), args.orderBy)[0];
        return row ? clone(row) : null;
      },
      findMany: async (args: { where?: Row; orderBy?: unknown; take?: number } = {}) => {
        await tick();
        this.runHooks("contentPostImageTask", "findMany", args as Row);
        const rows = sortRows(this.tasks.filter((task) => matches(task, args.where)), args.orderBy);
        return rows.slice(0, args.take ?? rows.length).map((row) => clone(row));
      },
      create: async (args: { data: Row }) => {
        await tick();
        this.runHooks("contentPostImageTask", "create", args as Row);
        const data = args.data;
        if (this.tasks.some((task) => task.providerRequestKey === data.providerRequestKey)) {
          throw new Error(`fake db: unique providerRequestKey ${String(data.providerRequestKey)}`);
        }
        if (
          this.tasks.some(
            (task) =>
              task.postId === data.postId &&
              task.slideIndex === data.slideIndex &&
              task.attempt === (data.attempt ?? 1),
          )
        ) {
          throw new Error("fake db: unique (postId, slideIndex, attempt)");
        }
        this.taskSeq += 1;
        const row: Row = {
          ...TASK_DEFAULTS,
          id: `task-${this.taskSeq}`,
          createdAt: this.clock.now,
          updatedAt: this.clock.now,
          ...data,
        };
        this.tasks.push(row);
        ctx?.undo.push(() => {
          this.tasks = this.tasks.filter((task) => task !== row);
        });
        return clone(row);
      },
      updateMany: async (args: { where?: Row; data: Row }) => {
        await tick();
        this.runHooks("contentPostImageTask", "updateMany", args as Row);
        const nextExternal = args.data.externalTaskId;
        let count = 0;
        for (const task of this.tasks) {
          if (!matches(task, args.where)) continue;
          if (
            typeof nextExternal === "string" &&
            this.tasks.some((other) => other !== task && other.externalTaskId === nextExternal)
          ) {
            throw new Error(`fake db: unique externalTaskId ${nextExternal}`);
          }
          this.write(ctx, task, { ...args.data, updatedAt: this.clock.now });
          count += 1;
        }
        return { count };
      },
    };
    const mediaAsset = {
      deleteMany: async (args: { where: { id: string } }) => {
        await tick();
        this.deletedAssets.push(args.where.id);
        return { count: 1 };
      },
    };
    const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      await tick();
      const sql = strings.join("?");
      if (!/FOR UPDATE/.test(sql)) throw new Error(`fake db: unsupported raw query ${sql}`);
      const postId = String(values[0]);
      if (ctx) await this.acquire(ctx, postId);
      return this.posts.some((post) => post.id === postId) ? [{ id: postId }] : [];
    };
    return { contentPost, contentPostImageTask, mediaAsset, $queryRaw };
  }

  /** 交给 service 的 db：顶层调用不在事务里，`$transaction` 给回调一份带撤销日志与行锁的 tx。 */
  client() {
    const top = this.delegates(null);
    return {
      ...top,
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        const ctx: TxContext = { undo: [], releases: [], held: new Set() };
        try {
          return await fn(this.delegates(ctx));
        } catch (error) {
          for (const undo of ctx.undo.reverse()) undo();
          throw error;
        } finally {
          for (const release of ctx.releases) release();
        }
      },
    };
  }
}
