export type CustomerRouteId =
  | "create"
  | "library"
  | "libraryDetail"
  | "brands"
  | "leads"
  | "status";

export const CUSTOMER_ROUTE_FALLBACKS = {
  create: "/app/create",
  library: "/app/create",
  libraryDetail: "/app/library",
  brands: "/app/create",
  leads: "/app/create",
  status: "/app/create",
} as const satisfies Record<CustomerRouteId, string>;

/**
 * 错误页「返回」按钮去往哪个区：按钮文字跟着去处走（「返回成品库」），
 * 不再一律写「返回创作工作台」。
 */
export const CUSTOMER_ROUTE_FALLBACK_AREAS = {
  create: "create",
  library: "create",
  libraryDetail: "library",
  brands: "create",
  leads: "create",
  status: "create",
} as const satisfies Record<CustomerRouteId, CustomerRouteId>;

/** 骨架屏的读数格数：与该页真实页头的读数格数一致，切页不跳。0 = 这页没有读数（2026-11-10：品牌），骨架也不画。 */
export const CUSTOMER_ROUTE_WALL_CELLS = {
  create: 4,
  library: 4,
  libraryDetail: 4,
  brands: 0,
  leads: 3,
  status: 4,
} as const satisfies Record<CustomerRouteId, number>;
