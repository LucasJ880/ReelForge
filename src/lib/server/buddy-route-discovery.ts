/**
 * Server-only, non-billing Buddy API discovery client.
 *
 * This module is intentionally separate from every video submission adapter.
 * It can only issue GET /models plus two fixed OpenAPI-document candidates
 * against the audited Buddy base URL. Credentials, response bodies, schema
 * descriptions, examples, defaults, and vendor extensions never cross its
 * return boundary.
 */

import { z } from "zod";
import type {
  BuddyApiContract,
  BuddyContractOperation,
  BuddyModelDto,
  BuddyVideoProviderRoute,
} from "@/lib/contracts/video-provider-routes";

export const BUDDY_API_BASE_URL =
  "https://shuyu-tiktok-tool.pages.dev/api/v1" as const;
const BUDDY_MODELS_URL = `${BUDDY_API_BASE_URL}/models` as const;
export const BUDDY_OPENAPI_PATHS = [
  "/openapi.json",
  "/docs/openapi.json",
] as const;
type BuddyOpenApiPath = (typeof BUDDY_OPENAPI_PATHS)[number];
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 512_000;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const SENSITIVE_FIELD =
  /(?:api[_-]?key|authorization|bearer|token|secret|credential|password|signature)/i;

const boundedString = z.string().trim().min(1).max(200);
const modelCandidateSchema = z
  .object({
    id: boundedString.optional(),
    model_id: boundedString.optional(),
    modelId: boundedString.optional(),
    model: boundedString.optional(),
    name: boundedString.optional(),
    display_name: boundedString.optional(),
    displayName: boundedString.optional(),
    version: boundedString.optional(),
    status: boundedString.optional(),
    capabilities: z.array(z.unknown()).max(50).optional(),
  })
  .strip();

const wrappedModelsSchema = z
  .object({
    models: z.array(z.unknown()).max(1_000).optional(),
    items: z.array(z.unknown()).max(1_000).optional(),
    data: z
      .union([
        z.array(z.unknown()).max(1_000),
        z
          .object({ models: z.array(z.unknown()).max(1_000) })
          .strip(),
      ])
      .optional(),
  })
  .strip();

type BuddyUnavailableReason = Exclude<
  BuddyVideoProviderRoute["unavailableReason"],
  null
>;

export type BuddyModelsDiscovery =
  | { available: true; models: BuddyModelDto[] }
  | { available: false; reason: BuddyUnavailableReason; models: [] };

export interface BuddyModelsDiscoveryOptions {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  timeoutMs?: number;
}

export type BuddyContractDiscovery = BuddyApiContract;
export type BuddyContractDiscoveryOptions = BuddyModelsDiscoveryOptions;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(trimmed)
    ? trimmed
    : null;
}

function safeDisplay(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function safePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (
    value.length < 1 ||
    value.length > 300 ||
    !value.startsWith("/") ||
    /[\u0000-\u001f\u007f\s?#]/.test(value)
  ) {
    return null;
  }
  return value;
}

function safeFieldName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > 120 ||
    !/^[A-Za-z_][A-Za-z0-9_.\[\]-]{0,119}$/.test(trimmed) ||
    SENSITIVE_FIELD.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function localRefTarget(
  root: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value) || typeof value.$ref !== "string") return null;
  if (!value.$ref.startsWith("#/")) return null;
  const segments = value.$ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cursor: unknown = root;
  for (const segment of segments.slice(0, 8)) {
    if (
      !isRecord(cursor) ||
      segment === "__proto__" ||
      segment === "constructor" ||
      segment === "prototype" ||
      !Object.prototype.hasOwnProperty.call(cursor, segment)
    ) {
      return null;
    }
    cursor = cursor[segment];
  }
  return isRecord(cursor) ? cursor : null;
}

function resolveLocalObject(
  root: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return localRefTarget(root, value) ?? value;
}

function collectSchemaFields(
  root: Record<string, unknown>,
  schemaValue: unknown,
): string[] {
  const result = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || result.size >= 60) return;
    const schema = resolveLocalObject(root, value);
    if (!schema) return;
    if (isRecord(schema.properties)) {
      for (const field of Object.keys(schema.properties).slice(0, 100)) {
        const safe = safeFieldName(field);
        if (safe) result.add(safe);
        if (result.size >= 60) return;
      }
    }
    for (const keyword of ["allOf", "oneOf", "anyOf"] as const) {
      const variants = schema[keyword];
      if (Array.isArray(variants)) {
        for (const variant of variants.slice(0, 20)) visit(variant, depth + 1);
      }
    }
  };
  visit(schemaValue, 0);
  return [...result].sort();
}

function requestSchema(
  root: Record<string, unknown>,
  operation: Record<string, unknown>,
): unknown {
  const requestBody = resolveLocalObject(root, operation.requestBody);
  if (!requestBody || !isRecord(requestBody.content)) return null;
  const content = requestBody.content;
  const media =
    (isRecord(content["application/json"])
      ? content["application/json"]
      : null) ??
    Object.values(content).find((value) => isRecord(value));
  return isRecord(media) ? media.schema : null;
}

function parameterNames(
  root: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
): { pathParameters: string[]; queryParameters: string[] } {
  const pathParameters = new Set<string>();
  const queryParameters = new Set<string>();
  const candidates = [pathItem.parameters, operation.parameters]
    .filter(Array.isArray)
    .flatMap((value) => value.slice(0, 100));
  for (const value of candidates) {
    const parameter = resolveLocalObject(root, value);
    if (!parameter) continue;
    const name = safeFieldName(parameter.name);
    if (!name) continue;
    if (parameter.in === "path") pathParameters.add(name);
    if (parameter.in === "query") queryParameters.add(name);
  }
  return {
    pathParameters: [...pathParameters].sort().slice(0, 20),
    queryParameters: [...queryParameters].sort().slice(0, 20),
  };
}

function boundedMetadata(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, 500).toLowerCase();
}

function isVideoOperation(
  path: string,
  operation: Record<string, unknown>,
): boolean {
  const tags = Array.isArray(operation.tags)
    ? operation.tags
        .filter((value): value is string => typeof value === "string")
        .slice(0, 20)
        .join(" ")
    : "";
  const searchable = [
    path,
    operation.operationId,
    operation.summary,
    tags,
  ]
    .map(boundedMetadata)
    .join(" ");
  return /(?:video|seedance|contents?\/generations?\/tasks?)/.test(searchable);
}

/**
 * Reduce an official OpenAPI document to the minimum fields needed for an
 * internal adapter review. No descriptions, examples, auth schemes, prices,
 * server URLs, or arbitrary vendor extensions are retained.
 */
export function sanitizeBuddyOpenApiPayload(
  payload: unknown,
  sourcePath: BuddyOpenApiPath,
): BuddyApiContract | null {
  if (!isRecord(payload) || !isRecord(payload.paths)) return null;
  const version = payload.openapi ?? payload.swagger;
  if (typeof version !== "string" || version.length > 40) return null;

  const operations: BuddyContractOperation[] = [];
  for (const [rawPath, rawPathItem] of Object.entries(payload.paths).slice(
    0,
    500,
  )) {
    const path = safePath(rawPath);
    if (!path || !isRecord(rawPathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = resolveLocalObject(payload, rawPathItem[method]);
      if (!operation || !isVideoOperation(path, operation)) continue;
      const params = parameterNames(payload, rawPathItem, operation);
      const operationId = safeIdentifier(operation.operationId);
      operations.push({
        path,
        method: method.toUpperCase() as BuddyContractOperation["method"],
        operationId,
        requestFields: collectSchemaFields(
          payload,
          requestSchema(payload, operation),
        ),
        ...params,
      });
      if (operations.length >= 30) break;
    }
    if (operations.length >= 30) break;
  }

  operations.sort((left, right) =>
    `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`),
  );
  if (operations.length === 0) {
    return {
      availability: "unavailable",
      sourcePath,
      unavailableReason: "video_contract_unavailable",
      submitPath: null,
      statusPath: null,
      cancelPath: null,
      operations: [],
    };
  }

  const semantic = (operation: BuddyContractOperation) =>
    `${operation.path} ${operation.operationId ?? ""}`.toLowerCase();
  const submit = operations.find(
    (operation) =>
      operation.method === "POST" &&
      /(?:video|generation|task)/.test(semantic(operation)),
  );
  const status = operations.find(
    (operation) =>
      operation.method === "GET" &&
      operation.pathParameters.length > 0 &&
      /(?:status|get.*task|retrieve.*task|query.*task|tasks?\/\{)/.test(
        semantic(operation),
      ),
  );
  const cancel = operations.find(
    (operation) =>
      (operation.method === "DELETE" || /cancel/.test(semantic(operation))) &&
      operation.pathParameters.length > 0,
  );

  return {
    availability: "available",
    sourcePath,
    unavailableReason: null,
    submitPath: submit?.path ?? null,
    statusPath: status?.path ?? null,
    cancelPath: cancel?.path ?? null,
    operations,
  };
}

function modelArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const wrapped = wrappedModelsSchema.safeParse(payload);
  if (!wrapped.success) return null;
  if (wrapped.data.models) return wrapped.data.models;
  if (wrapped.data.items) return wrapped.data.items;
  if (Array.isArray(wrapped.data.data)) return wrapped.data.data;
  if (wrapped.data.data && "models" in wrapped.data.data) {
    return wrapped.data.data.models;
  }
  return null;
}

function sanitizeModel(value: unknown): BuddyModelDto | null {
  if (typeof value === "string") {
    const id = safeIdentifier(value);
    return id
      ? { id, name: null, version: null, status: null, capabilities: [] }
      : null;
  }

  const parsed = modelCandidateSchema.safeParse(value);
  if (!parsed.success) return null;
  const candidate = parsed.data;
  const id = [
    candidate.id,
    candidate.model_id,
    candidate.modelId,
    candidate.model,
    candidate.name,
  ]
    .map(safeIdentifier)
    .find((item): item is string => item != null);
  if (!id) return null;

  const name = safeDisplay(
    candidate.display_name ?? candidate.displayName ?? candidate.name,
    120,
  );
  const version = safeDisplay(candidate.version, 80);
  const statusValue = safeDisplay(candidate.status, 40)?.toLowerCase() ?? null;
  const status =
    statusValue && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(statusValue)
      ? statusValue
      : null;
  const capabilities = Array.from(
    new Set(
      (candidate.capabilities ?? [])
        .map((item) => safeIdentifier(item))
        .filter((item): item is string => item != null)
        .map((item) => item.slice(0, 60)),
    ),
  ).slice(0, 20);

  return { id, name, version, status, capabilities };
}

export function sanitizeBuddyModelsPayload(
  payload: unknown,
): BuddyModelDto[] | null {
  const items = modelArray(payload);
  if (!items) return null;
  const byId = new Map<string, BuddyModelDto>();
  for (const item of items.slice(0, 1_000)) {
    const model = sanitizeModel(item);
    if (model && !byId.has(model.id)) byId.set(model.id, model);
    if (byId.size >= 100) break;
  }
  return [...byId.values()];
}

function unavailable(reason: BuddyUnavailableReason): BuddyModelsDiscovery {
  return { available: false, reason, models: [] };
}

export async function discoverBuddyModels(
  options: BuddyModelsDiscoveryOptions = {},
): Promise<BuddyModelsDiscovery> {
  if (typeof window !== "undefined") {
    throw new Error("Buddy route discovery is server-only");
  }

  const env = options.env ?? process.env;
  const apiKey = env.shuyu_api_key?.trim();
  if (!apiKey) return unavailable("not_configured");

  const timeoutMs = Math.min(
    15_000,
    Math.max(250, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(BUDDY_MODELS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return unavailable("authentication_rejected");
    }
    if (response.status === 404 || response.status === 405) {
      return unavailable("models_endpoint_unavailable");
    }
    if (response.status === 429) return unavailable("rate_limited");
    if (!response.ok) return unavailable("upstream_unavailable");

    const raw = await response.text();
    if (raw.length === 0 || raw.length > MAX_RESPONSE_BYTES) {
      return unavailable("invalid_response");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return unavailable("invalid_response");
    }
    const models = sanitizeBuddyModelsPayload(payload);
    return models == null
      ? unavailable("invalid_response")
      : { available: true, models };
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return unavailable("timeout");
    }
    return unavailable("upstream_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function unavailableContract(
  reason: BuddyApiContract["unavailableReason"],
  sourcePath: BuddyOpenApiPath | null = null,
): BuddyApiContract {
  if (reason == null) throw new Error("unavailable contract needs a reason");
  return {
    availability: "unavailable",
    sourcePath,
    unavailableReason: reason,
    submitPath: null,
    statusPath: null,
    cancelPath: null,
    operations: [],
  };
}

export async function discoverBuddyApiContract(
  options: BuddyContractDiscoveryOptions = {},
): Promise<BuddyContractDiscovery> {
  if (typeof window !== "undefined") {
    throw new Error("Buddy contract discovery is server-only");
  }

  const env = options.env ?? process.env;
  const apiKey = env.shuyu_api_key?.trim();
  if (!apiKey) return unavailableContract("not_configured");

  const timeoutMs = Math.min(
    15_000,
    Math.max(250, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
  );
  let strongestFailure: BuddyApiContract["unavailableReason"] = "not_found";
  let validDocumentWithoutVideo: BuddyApiContract | null = null;

  for (const sourcePath of BUDDY_OPENAPI_PATHS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (options.fetchImpl ?? fetch)(
        `${BUDDY_API_BASE_URL}${sourcePath}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (response.status === 404 || response.status === 405) continue;
      if (!response.ok) {
        strongestFailure = "upstream_unavailable";
        continue;
      }
      const raw = await response.text();
      if (raw.length === 0 || raw.length > MAX_RESPONSE_BYTES) {
        strongestFailure = "invalid_response";
        continue;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        strongestFailure = "invalid_response";
        continue;
      }
      const sanitized = sanitizeBuddyOpenApiPayload(payload, sourcePath);
      if (!sanitized) {
        strongestFailure = "invalid_response";
        continue;
      }
      if (JSON.stringify(sanitized).includes(apiKey)) {
        strongestFailure = "invalid_response";
        continue;
      }
      if (sanitized.availability === "available") return sanitized;
      validDocumentWithoutVideo ??= sanitized;
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        strongestFailure = "timeout";
      } else {
        strongestFailure = "upstream_unavailable";
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return validDocumentWithoutVideo ?? unavailableContract(strongestFailure);
}

export function buddyVideoProviderRoute(
  discovery: BuddyModelsDiscovery,
  contract: BuddyContractDiscovery,
): BuddyVideoProviderRoute {
  return {
    id: "buddy",
    provider: "buddy",
    displayName: "Buddy API",
    apiBaseUrl: BUDDY_API_BASE_URL,
    discoveryMode: "models_and_openapi_read_only_non_billing",
    availability: discovery.available ? "available" : "unavailable",
    unavailableReason: discovery.available ? null : discovery.reason,
    models: discovery.models,
    contract,
  };
}
