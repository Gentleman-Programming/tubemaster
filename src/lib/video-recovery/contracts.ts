import type { CredentialRef, ResolvedCredentials } from "../video-metadata/contracts";
import type { QuotaAccountant } from "../quota/accountant";

export type RecoveryVideo = {
  videoId: string;
  channelId: string;
  privacyStatus: string;
  publishAt?: string | null;
};

export type RecoveryReconcileProviderResult =
  | { status: "succeeded"; videoId: string; channelId: string; privacyStatus: string }
  | { status: "absent"; channelId: string }
  | { status: "unknown"; channelId: string; reason: string }
  | { status: "unsupported"; reason: string };

export type RecoveryReturnProviderResult =
  | { status: "cancelled"; videoId: string; channelId: string; privacyStatus: "private" }
  | { status: "unsupported"; reason: string };

export type RecoveryProvider = {
  reconcile(args: {
    credentials: ResolvedCredentials;
    targetOperationId: string;
    videoId?: string;
    operationId: string;
    channelId: string;
    quotaAccountant: QuotaAccountant;
  }): Promise<RecoveryReconcileProviderResult>;
  inspect(args: {
    credentials: ResolvedCredentials;
    videoId: string;
    operationId: string;
    channelId: string;
    quotaAccountant: QuotaAccountant;
  }): Promise<RecoveryVideo | null>;
  returnToPrivate(args: {
    credentials: ResolvedCredentials;
    videoId: string;
    operationId: string;
    channelId: string;
    quotaAccountant: QuotaAccountant;
  }): Promise<RecoveryReturnProviderResult>;
};

export type RecoveryReconcileRequest = {
  credentialRef: CredentialRef;
  expectedChannelId: string;
  operationId: string;
  videoId?: string;
};

export type RecoveryReconcileResult =
  | { status: "succeeded"; operationId: string; videoId: string; channelId: string; privacyStatus: string }
  | { status: "absent"; operationId: string; channelId: string }
  | { status: "unknown"; operationId: string; channelId: string; reason: string; retryAutomatically: false }
  | { status: "unsupported"; operationId: string; reason: string };

export type RecoveryBatchReconcileRequest = {
  credentialRef: CredentialRef;
  expectedChannelId: string;
  items: Array<{ operationId: string; videoId?: string }>;
};

export type RecoveryBatchReconcileItem = RecoveryReconcileResult & { index: number };
export type RecoveryBatchReconcileResult = {
  status: "completed";
  channelId: string;
  items: RecoveryBatchReconcileItem[];
};

export type RecoveryCancelRequest = {
  credentialRef: CredentialRef;
  expectedChannelId: string;
  operationId: string;
  videoId: string;
  dryRun: boolean;
  confirmed?: boolean;
  confirmationToken?: string;
};

export type RecoveryCancelResult =
  | {
      status: "validated";
      operationId: string;
      recoveryOperationId: string;
      videoId: string;
      channelId: string;
      privacyStatus: string;
      publishAt?: string | null;
      quotaEstimate: number;
      confirmationToken: string;
      dryRun: true;
    }
  | {
      status: "cancelled" | "already_private";
      operationId: string;
      recoveryOperationId: string;
      videoId: string;
      channelId: string;
      privacyStatus: "private";
      dryRun: false;
    }
  | {
      status: "unsupported";
      operationId: string;
      recoveryOperationId: string;
      videoId: string;
      channelId: string;
      reason: string;
      dryRun: false;
    };
