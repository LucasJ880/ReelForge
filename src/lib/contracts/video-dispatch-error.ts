import { z } from "zod";
import { customerApiErrorSchema } from "@/lib/contracts/customer-api";

/**
 * Dispatch deliberately allows a small, typed diagnostic extension. Provider
 * identifiers, raw issues, stack traces and request payloads remain forbidden.
 */
export const videoDispatchErrorSchema = customerApiErrorSchema
  .extend({
    blockers: z.array(z.string().min(1).max(500)).max(50).optional(),
    resource: z.string().min(1).max(80).optional(),
    used: z.number().finite().nonnegative().optional(),
    limit: z.number().finite().nonnegative().optional(),
    periodKey: z.string().min(1).max(40).optional(),
  })
  .strict();
