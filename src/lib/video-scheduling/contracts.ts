import type { CredentialRef, ResolvedCredentials } from "../video-metadata/contracts";
import type { QuotaAccountant } from "../quota/accountant";

export type ScheduleRequest = {
  credentialRef: CredentialRef;
  videoId: string;
  expectedChannelId: string;
  timezone: string;
  publishAt: string; // Local ISO timestamp without offset; timezone is supplied separately.
  dryRun: boolean;
  confirmed?: boolean;
  confirmationToken?: string;
};
export type ScheduleResult = {
  status: "validated" | "scheduled";
  operationId: string;
  videoId: string;
  channelId: string;
  publishAtUtc: string;
  quotaEstimate: number;
  dryRun: boolean;
  confirmationToken?: string;
};
export type ScheduleVideo = { channelId: string; privacyStatus: string; publishAt?: string | null };
export type ScheduleProvider = {
  inspect(args: { credentials: ResolvedCredentials; videoId: string; operationId: string; channelId: string; quotaAccountant?: QuotaAccountant }): Promise<ScheduleVideo | null>;
  schedule(args: { credentials: ResolvedCredentials; videoId: string; publishAtUtc: string; operationId: string; channelId: string; quotaAccountant: QuotaAccountant }): Promise<void>;
};
