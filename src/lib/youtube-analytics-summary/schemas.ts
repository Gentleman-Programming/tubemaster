import { z } from "zod";

const metric = z.union([z.number(), z.string()]).transform((value, context) => {
  if (typeof value === "string" && value.trim() === "") {
    context.addIssue({ code: "custom", message: "Invalid metric" });
    return z.NEVER;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    context.addIssue({ code: "custom", message: "Invalid metric" });
    return z.NEVER;
  }
  return number;
});

export const dailyAnalyticsRowSchema = z.object({
  date: z.iso.date(),
  views: metric,
  likes: metric,
  comments: metric,
  estimatedMinutesWatched: metric,
});
