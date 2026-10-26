export type CustomerRouteId =
  | "create"
  | "createImages"
  | "batches"
  | "newBatch"
  | "batchDetail"
  | "racing"
  | "library"
  | "libraryDetail"
  | "templates"
  | "plan"
  | "wins"
  | "brands"
  | "leads"
  | "status";

export const CUSTOMER_ROUTE_FALLBACKS = {
  create: "/app/create",
  createImages: "/app/create",
  batches: "/app/create",
  newBatch: "/app/batches",
  batchDetail: "/app/batches",
  racing: "/app/create",
  library: "/app/create",
  libraryDetail: "/app/library",
  templates: "/app/create",
  plan: "/app/create",
  wins: "/app/plan",
  brands: "/app/create",
  leads: "/app/plan",
  status: "/app/create",
} as const satisfies Record<CustomerRouteId, string>;

/**
 * 错误页「返回」按钮去往哪个区：按钮文字跟着去处走（「返回成品库」「返回本周内容」），
 * 不再一律写「返回创作工作台」。
 */
export const CUSTOMER_ROUTE_FALLBACK_AREAS = {
  create: "create",
  createImages: "create",
  batches: "create",
  newBatch: "batches",
  batchDetail: "batches",
  racing: "create",
  library: "create",
  libraryDetail: "library",
  templates: "create",
  plan: "create",
  wins: "plan",
  brands: "create",
  leads: "plan",
  status: "create",
} as const satisfies Record<CustomerRouteId, CustomerRouteId>;

/** 骨架屏的读数墙格数：与该页真实行情头的读数格数一致，切页不跳。 */
export const CUSTOMER_ROUTE_WALL_CELLS = {
  create: 4,
  createImages: 4,
  batches: 5,
  newBatch: 3,
  batchDetail: 6,
  racing: 4,
  library: 4,
  libraryDetail: 4,
  templates: 4,
  plan: 4,
  wins: 4,
  brands: 3,
  leads: 3,
  status: 4,
} as const satisfies Record<CustomerRouteId, number>;
