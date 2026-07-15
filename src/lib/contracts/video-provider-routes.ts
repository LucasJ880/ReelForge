import { z } from "zod";

export const buddyRouteUnavailableReasons = [
  "not_configured",
  "authentication_rejected",
  "models_endpoint_unavailable",
  "rate_limited",
  "timeout",
  "upstream_unavailable",
  "invalid_response",
] as const;

export const buddyContractUnavailableReasons = [
  "not_configured",
  "not_found",
  "timeout",
  "upstream_unavailable",
  "invalid_response",
  "video_contract_unavailable",
] as const;

export const buddyContractOperationSchema = z
  .object({
    path: z.string().startsWith("/").max(300),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    operationId: z.string().min(1).max(160).nullable(),
    requestFields: z.array(z.string().min(1).max(120)).max(60),
    pathParameters: z.array(z.string().min(1).max(120)).max(20),
    queryParameters: z.array(z.string().min(1).max(120)).max(20),
  })
  .strict();

export const buddyApiContractSchema = z
  .object({
    availability: z.enum(["available", "unavailable"]),
    sourcePath: z
      .enum(["/openapi.json", "/docs/openapi.json"])
      .nullable(),
    unavailableReason: z.enum(buddyContractUnavailableReasons).nullable(),
    submitPath: z.string().startsWith("/").max(300).nullable(),
    statusPath: z.string().startsWith("/").max(300).nullable(),
    cancelPath: z.string().startsWith("/").max(300).nullable(),
    operations: z.array(buddyContractOperationSchema).max(30),
  })
  .strict();

export const buddyModelDtoSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(120).nullable(),
    version: z.string().min(1).max(80).nullable(),
    status: z.string().min(1).max(40).nullable(),
    capabilities: z.array(z.string().min(1).max(60)).max(20),
  })
  .strict();

export const buddyVideoProviderRouteSchema = z
  .object({
    id: z.literal("buddy"),
    provider: z.literal("buddy"),
    displayName: z.literal("Buddy API"),
    apiBaseUrl: z.literal("https://shuyu-tiktok-tool.pages.dev/api/v1"),
    discoveryMode: z.literal("models_and_openapi_read_only_non_billing"),
    availability: z.enum(["available", "unavailable"]),
    unavailableReason: z.enum(buddyRouteUnavailableReasons).nullable(),
    models: z.array(buddyModelDtoSchema).max(100),
    contract: buddyApiContractSchema,
  })
  .strict();

export const internalVideoProviderRoutesResponseSchema = z
  .object({
    ok: z.literal(true),
    routes: z.array(buddyVideoProviderRouteSchema).length(1),
  })
  .strict();

export type BuddyModelDto = z.infer<typeof buddyModelDtoSchema>;
export type BuddyContractOperation = z.infer<
  typeof buddyContractOperationSchema
>;
export type BuddyApiContract = z.infer<typeof buddyApiContractSchema>;
export type BuddyVideoProviderRoute = z.infer<
  typeof buddyVideoProviderRouteSchema
>;
export type InternalVideoProviderRoutesResponse = z.infer<
  typeof internalVideoProviderRoutesResponseSchema
>;
