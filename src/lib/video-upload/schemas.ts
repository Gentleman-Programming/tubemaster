import { z } from "zod";
import { credentialRefSchema } from "../video-metadata/schemas";

export const uploadRequestSchema = z.object({
  credentialRef: credentialRefSchema,
  expectedChannelId: z.string().trim().min(1),
  filePath: z.string().trim().min(1),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional().refine((tags) => !tags || tags.join(",").length <= 500, "Tags are too long"),
  categoryId: z.string().regex(/^\d+$/).optional(),
  defaultLanguage: z.string().trim().min(1).max(35).optional(),
  defaultAudioLanguage: z.string().trim().min(1).max(35).optional(),
  license: z.enum(["youtube", "creativeCommon"]).optional(),
  selfDeclaredMadeForKids: z.boolean().optional(),
  containsSyntheticMedia: z.boolean().optional(),
  visibility: z.literal("private"),
  dryRun: z.boolean().optional(),
  confirmed: z.boolean().optional(),
}).strict();
