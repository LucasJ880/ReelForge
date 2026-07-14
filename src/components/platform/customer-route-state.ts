export type CustomerRouteId =
  | "create"
  | "createImages"
  | "batches"
  | "batchDetail"
  | "racing"
  | "library"
  | "templates";

export const CUSTOMER_ROUTE_FALLBACKS = {
  create: "/app/create",
  createImages: "/app/create",
  batches: "/app/create",
  batchDetail: "/app/batches",
  racing: "/app/create",
  library: "/app/create",
  templates: "/app/create",
} as const satisfies Record<CustomerRouteId, string>;
