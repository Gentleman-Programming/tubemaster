import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const analyticsSummaryInputSchema = z.object({ startDate: date, endDate: date }).strict();
export const analyticsRetentionInputSchema = z.object({
  videoId: z.string().trim().min(1).max(100),
  startDate: date,
  endDate: date,
}).strict();
