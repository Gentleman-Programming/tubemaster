import { z } from "zod";
import { credentialRefSchema } from "../video-metadata/schemas";

const operationIdSchema = z.string().trim().min(1).max(160);

export const recoveryReconcileRequestSchema = z.object({
  credentialRef: credentialRefSchema,
  expectedChannelId: z.string().trim().min(1),
  operationId: operationIdSchema,
  videoId: z.string().trim().min(1).optional(),
}).strict();

export const recoveryBatchReconcileRequestSchema = z.object({
  credentialRef: credentialRefSchema,
  expectedChannelId: z.string().trim().min(1),
  items: z.array(z.object({ operationId: operationIdSchema, videoId: z.string().trim().min(1).optional() }).strict()).min(1).max(10),
}).strict();

export const recoveryCancelRequestSchema = z.object({
  credentialRef: credentialRefSchema,
  expectedChannelId: z.string().trim().min(1),
  operationId: operationIdSchema,
  videoId: z.string().trim().min(1),
  dryRun: z.boolean(),
  confirmed: z.boolean().optional(),
  confirmationToken: z.string().optional(),
}).strict();
