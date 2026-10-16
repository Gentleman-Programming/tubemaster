import { z } from "zod";
import { credentialRefSchema } from "../video-metadata/schemas";

export const scheduleRequestSchema = z.object({
  credentialRef: credentialRefSchema,
  videoId: z.string().trim().min(1),
  expectedChannelId: z.string().trim().min(1),
  timezone: z.string().min(1).refine((value) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }),
  publishAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
  dryRun: z.boolean(),
  confirmed: z.boolean().optional(),
  confirmationToken: z.string().optional(),
}).strict();

/** Match local wall time against actual instants; zero or two matches means a DST gap/fold. */
export function toUnambiguousUtc(local: string, timezone: string): string | null {
  const approximate = Date.parse(`${local}Z`);
  if (!Number.isFinite(approximate) || new Date(approximate).toISOString().slice(0, 19) !== local) return null;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const matches: number[] = [];
  // Timezone offsets are minute-granular; the possible UTC offset is within 24 hours.
  for (let offset = -1440; offset <= 1440; offset++) {
    const instant = approximate + offset * 60_000;
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
    if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` === local) matches.push(instant);
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}
