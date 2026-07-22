import { z } from "zod";
import { customerApiErrorSchema } from "@/lib/contracts/customer-api";

/** Stable customer DTO returned after an upload has been durably stored. */
export const uploadBlobSuccessSchema = z
  .object({
    ok: z.literal(true),
    asset: z
      .object({
        id: z.string().min(1),
        url: z.string().url(),
        mimeType: z.string().min(1),
        width: z.number().int().positive().nullable(),
        height: z.number().int().positive().nullable(),
      })
      .strict(),
  })
  .strict();

/** Upload is the only endpoint allowed to expose upload-byte quota metadata. */
export const uploadBlobQuotaErrorSchema = customerApiErrorSchema
  .extend({
    code: z.literal("QUOTA_EXCEEDED"),
    resource: z.literal("BLOB_UPLOAD_BYTES"),
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    periodKey: z.string().min(1).max(40),
  })
  .strict();

export const uploadBlobResponseSchema = z.union([
  uploadBlobSuccessSchema,
  uploadBlobQuotaErrorSchema,
  customerApiErrorSchema,
]);

export type UploadBlobSuccess = z.infer<typeof uploadBlobSuccessSchema>;

export function uploadBlobSuccess(args: {
  asset: {
    id: string;
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  };
}): UploadBlobSuccess {
  return uploadBlobSuccessSchema.parse({ ok: true, ...args });
}
