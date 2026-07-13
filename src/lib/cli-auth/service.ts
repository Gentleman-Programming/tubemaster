import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import {
  buildGoogleLoopbackAuthUrl,
  exchangeGoogleAuthCode,
  fetchGoogleIdentity,
  generateOAuthState,
  generatePkcePair,
  pollGoogleDeviceAuthorizationToken,
  revokeGoogleToken,
  startGoogleDeviceAuthorization,
  YOUTUBE_READ_SCOPE,
  type DeviceAuthorizationStart,
  type GoogleIdentity,
  type OAuthTokenSet,
} from "@/lib/auth";
import {
  clearUserOAuthTokens,
  getSelectedChannelId,
  setSelectedChannelId,
  getOAuthUserSummary,
  getUserOAuthTokens,
  listOAuthUsers,
  upsertOAuthUserFromCli,
  type OAuthUserSummary,
} from "@/lib/db";
import { createWriteContextYoutubeApiAdapter } from "@/lib/write-context/adapters/youtube-api";
import { createWriteContextService } from "@/lib/write-context/service";
import type { WriteChannelContext } from "@/lib/write-context/contracts";
import type { CredentialRef, ResolvedCredentials } from "@/lib/video-metadata/contracts";
import { DomainError } from "@/lib/video-metadata/contracts";
import { resolveGoogleCredentials } from "@/lib/video-metadata/adapters/google-auth";
import {
  authCallbackInvalid,
  authUserNotFound,
} from "./errors";
import { createActiveAuthStorage, type ActiveAuthStorage } from "./storage";

export type AuthUserSummary = OAuthUserSummary & { isActive: boolean };

export type SelectUserResult = {
  activeUser: AuthUserSummary;
  previousActiveUserId: string | null;
  changed: boolean;
  effectiveCredentialRef: { userId: string };
  writeChannel: WriteChannelContext;
  activeWriteChannel: WriteChannelContext["activeWriteChannel"];
  selectedChannelId: string | null;
  alignment: WriteChannelContext["alignment"];
  requiresReauth: boolean;
  affectsRemoteOAuth: false;
};

type LoopbackCallbackResult = {
  code: string;
  state: string;
};

type BrowserOpenCommand = {
  command: string;
  args: string[];
  options: {
    stdio: "ignore";
    detached: true;
  };
};

type BrowserOpenSpawn = typeof spawn;
type BrowserOpenLogger = (message: string) => void;

const CLI_OAUTH_OPENER_DEBUG_ENV = "CLI_OAUTH_OPENER_DEBUG";

type CliAuthServiceDependencies = {
  storage: ActiveAuthStorage;
  openBrowser: (url: string) => Promise<void>;
  oauth: {
    generateState: () => string;
    generatePkcePair: () => { verifier: string; challenge: string };
    buildLoopbackAuthUrl: typeof buildGoogleLoopbackAuthUrl;
    exchangeAuthCode: typeof exchangeGoogleAuthCode;
    fetchIdentity: typeof fetchGoogleIdentity;
    startDeviceAuthorization: typeof startGoogleDeviceAuthorization;
    pollDeviceAuthorizationToken: typeof pollGoogleDeviceAuthorizationToken;
    revokeToken: typeof revokeGoogleToken;
  };
  credentialResolver: typeof resolveGoogleCredentials;
  writeContext: {
    getWriteChannelContext(args: {
      credentialRef: CredentialRef;
      credentials?: ResolvedCredentials;
      expectedChannelId?: string;
    }): Promise<WriteChannelContext>;
    listKnownChannels(args: {
      credentialRef: CredentialRef;
      credentials?: ResolvedCredentials;
      expectedChannelId?: string;
    }): Promise<{
      knownChannels: WriteChannelContext["knownChannels"];
      alignment: WriteChannelContext["alignment"];
      activeWriteChannel: WriteChannelContext["activeWriteChannel"];
      selectedChannelId: WriteChannelContext["selectedChannelId"];
      expectedChannelId: WriteChannelContext["expectedChannelId"];
      source: WriteChannelContext["source"];
      requiresReauth: WriteChannelContext["requiresReauth"];
    }>;
    selectWriteChannel(args: {
      credentialRef: CredentialRef;
      channelId: string;
      credentials?: ResolvedCredentials;
    }): Promise<{
      selectedChannelId: string | null;
      activeWriteChannel: WriteChannelContext["activeWriteChannel"];
      expectedChannelId: string | null;
      source: WriteChannelContext["source"];
      alignment: WriteChannelContext["alignment"];
      knownChannels: WriteChannelContext["knownChannels"];
      requiresReauth: boolean;
      message: string;
      recommendedAction: string | null;
    }>;
  };
    db: {
    upsertUser: typeof upsertOAuthUserFromCli;
    listUsers: typeof listOAuthUsers;
    getUserSummary: typeof getOAuthUserSummary;
    getUserTokens: typeof getUserOAuthTokens;
      clearUserTokens: typeof clearUserOAuthTokens;
      getSelectedChannelId: typeof getSelectedChannelId;
      setSelectedChannelId: typeof setSelectedChannelId;
    };
  startLoopbackCallbackServer: (args: {
    expectedState: string;
    timeoutMs: number;
  }) => Promise<{ redirectUri: string; waitForCallback: Promise<LoopbackCallbackResult> }>;
};

export function buildBrowserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform
): BrowserOpenCommand {
  if (platform === "win32") {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
      options: {
        stdio: "ignore",
        detached: true,
      },
    };
  }

  return {
    command: platform === "darwin" ? "open" : "xdg-open",
    args: [url],
    options: {
      stdio: "ignore",
      detached: true,
    },
  };
}

function isCliOAuthOpenerDebugEnabled() {
  return process.env[CLI_OAUTH_OPENER_DEBUG_ENV] === "1";
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=?&%-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "''")}'`;
}

function buildReproductionCommand(browserOpenCommand: BrowserOpenCommand) {
  return [browserOpenCommand.command, ...browserOpenCommand.args]
    .map(shellQuote)
    .join(" ");
}

function logCliOAuthOpenerDebug(
  logger: BrowserOpenLogger,
  event: string,
  details: Record<string, unknown>
) {
  logger(JSON.stringify({
    scope: "cli-oauth-opener",
    event,
    timestamp: new Date().toISOString(),
    ...details,
  }));
}

function serializeChildProcessError(error: Error & { code?: string }) {
  return {
    name: error.name,
    message: error.message,
    code: error.code,
  };
}

function attachCliOAuthOpenerDebugHandlers(args: {
  child: ChildProcess;
  logger: BrowserOpenLogger;
}) {
  const childPid = () => args.child.pid ?? null;

  args.child.on("spawn", () => {
    logCliOAuthOpenerDebug(args.logger, "spawn", { childPid: childPid() });
  });
  args.child.on("error", (error) => {
    logCliOAuthOpenerDebug(args.logger, "error", {
      childPid: childPid(),
      error: serializeChildProcessError(error),
    });
  });
  args.child.on("exit", (code, signal) => {
    logCliOAuthOpenerDebug(args.logger, "exit", { childPid: childPid(), code, signal });
  });
  args.child.on("close", (code, signal) => {
    logCliOAuthOpenerDebug(args.logger, "close", { childPid: childPid(), code, signal });
  });
}

export function openBrowserForCliOAuth(
  url: string,
  deps: {
    spawnProcess?: BrowserOpenSpawn;
    logger?: BrowserOpenLogger;
  } = {}
) {
  const browserOpenCommand = buildBrowserOpenCommand(url);
  const spawnProcess = deps.spawnProcess ?? spawn;
  const logger = deps.logger ?? console.error;
  const debugEnabled = isCliOAuthOpenerDebugEnabled();

  if (debugEnabled) {
    logCliOAuthOpenerDebug(logger, "before-spawn", {
      command: browserOpenCommand.command,
      args: browserOpenCommand.args,
      options: browserOpenCommand.options,
      platform: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        execPath: process.execPath,
        comSpec: process.env.ComSpec ?? null,
      },
      oauthUrl: url,
      reproductionCommand: buildReproductionCommand(browserOpenCommand),
    });
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawnProcess(
      browserOpenCommand.command,
      browserOpenCommand.args,
      browserOpenCommand.options
    );

    if (debugEnabled) {
      attachCliOAuthOpenerDebugHandlers({ child, logger });
    }

    child.on("error", reject);
    child.unref();

    if (debugEnabled) {
      logCliOAuthOpenerDebug(logger, "opener-promise-resolve", {
        childPid: child.pid ?? null,
      });
    }

    resolve();
  });
}

function defaultOpenBrowser(url: string) {
  return openBrowserForCliOAuth(url);
}

function createLoopbackCallbackServer(args: {
  expectedState: string;
  timeoutMs: number;
}): Promise<{ redirectUri: string; waitForCallback: Promise<LoopbackCallbackResult> }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const loopbackPort = Number(process.env.CLI_OAUTH_CALLBACK_PORT ?? "8787");

    const waitForCallback = new Promise<LoopbackCallbackResult>((innerResolve, innerReject) => {
      const timeout = setTimeout(() => {
        server.close();
        innerReject(
          authCallbackInvalid("OAuth callback timeout. Retry with `auth login`.", {
            reason: "timeout",
          })
        );
      }, args.timeoutMs);

      server.on("request", (req, res) => {
        try {
          const callbackUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
          const state = callbackUrl.searchParams.get("state");
          const code = callbackUrl.searchParams.get("code");
          const error = callbackUrl.searchParams.get("error");

          if (error) {
            res.statusCode = 400;
            res.end("Authorization failed. You can close this tab.");
            clearTimeout(timeout);
            server.close();
            innerReject(
              authCallbackInvalid("OAuth callback returned an error", {
                reason: error,
              })
            );
            return;
          }

          if (!code || !state || state !== args.expectedState) {
            res.statusCode = 400;
            res.end("Invalid callback payload. You can close this tab.");
            clearTimeout(timeout);
            server.close();
            innerReject(
              authCallbackInvalid("OAuth callback state validation failed", {
                reason: "invalid_state_or_code",
              })
            );
            return;
          }

          res.statusCode = 200;
          res.end("Authorization complete. You can close this tab.");
          clearTimeout(timeout);
          server.close();
          innerResolve({ code, state });
        } catch {
          clearTimeout(timeout);
          server.close();
          innerReject(authCallbackInvalid("Failed to process OAuth callback", { reason: "parse_error" }));
        }
      });
    });

    server.listen(loopbackPort, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(authCallbackInvalid("Could not bind loopback callback server"));
        return;
      }

      resolve({
        redirectUri: `http://127.0.0.1:${address.port}`,
        waitForCallback,
      });
    });

    server.on("error", (error) => {
      reject(
        authCallbackInvalid("Loopback callback server failed", {
          reason: error.message,
          port: loopbackPort,
        })
      );
    });
  });
}

function toAuthUserSummary(
  user: OAuthUserSummary,
  activeUserId: string | null
): AuthUserSummary {
  return {
    ...user,
    isActive: activeUserId === user.userId,
  };
}

const selectWriteChannelInputSchema = z
  .object({
    channelId: z
      .string()
      .min(1, "channelId is required")
      .regex(/^UC[a-zA-Z0-9_-]{22}$/, "channelId must be a valid YouTube channel id"),
    credentialRef: z
      .union([
        z.object({ userId: z.string().min(1) }).strict(),
        z
          .object({
            accessToken: z.string().min(1),
            refreshToken: z.string().optional(),
            tokenExpiry: z.number().int().positive().optional(),
            scope: z.string().optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

const selectUserInputSchema = z
  .object({
    userId: z.string().min(1, "userId is required"),
  })
  .strict();

function toValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

function fallbackWriteChannelContext(args: {
  selectedChannelId: string | null;
  reason: "auth_unavailable";
}): WriteChannelContext {
  const requiresReauth = args.selectedChannelId !== null;
  return {
    activeWriteChannel: null,
    selectedChannelId: args.selectedChannelId,
    expectedChannelId: args.selectedChannelId,
    source: args.selectedChannelId ? "stored" : "missing",
    knownChannels: args.selectedChannelId
      ? [
          {
            id: args.selectedChannelId,
            title: null,
            source: "selected",
            isActive: false,
            isSelected: true,
          },
        ]
      : [],
    alignment: {
      status: "unresolved",
      requiresReauth,
      message:
        args.reason === "auth_unavailable"
          ? "Cannot resolve active OAuth channel with current credentials."
          : "Write channel alignment is unresolved.",
      recommendedAction: args.selectedChannelId
        ? "Reauthenticate with the selected channel and retry."
        : "Authenticate and select an expected write channel.",
    },
    requiresReauth,
  };
}

async function persistAuthenticatedUser(args: {
  identity: GoogleIdentity;
  tokens: OAuthTokenSet;
  deps: CliAuthServiceDependencies;
}) {
  await args.deps.db.upsertUser({
    userId: args.identity.userId,
    email: args.identity.email,
    name: args.identity.name,
    image: args.identity.image,
    accessToken: args.tokens.accessToken,
    refreshToken: args.tokens.refreshToken,
    tokenExpiry: args.tokens.tokenExpiry,
    scope: args.tokens.scope,
  });

  await args.deps.storage.write({ activeUserId: args.identity.userId });
}

export function createCliAuthService(
  deps: Partial<CliAuthServiceDependencies> = {}
) {
  const resolvedDeps: CliAuthServiceDependencies = {
    storage: deps.storage ?? createActiveAuthStorage(),
    openBrowser: deps.openBrowser ?? defaultOpenBrowser,
    oauth: deps.oauth ?? {
      generateState: generateOAuthState,
      generatePkcePair,
      buildLoopbackAuthUrl: buildGoogleLoopbackAuthUrl,
      exchangeAuthCode: exchangeGoogleAuthCode,
      fetchIdentity: fetchGoogleIdentity,
      startDeviceAuthorization: startGoogleDeviceAuthorization,
      pollDeviceAuthorizationToken: pollGoogleDeviceAuthorizationToken,
      revokeToken: revokeGoogleToken,
    },
    credentialResolver: deps.credentialResolver ?? resolveGoogleCredentials,
    writeContext:
      deps.writeContext ??
      createWriteContextService({
        youtubeApi: createWriteContextYoutubeApiAdapter(),
        channelSelectionStore: {
          getSelectedChannelId,
          setSelectedChannelId,
        },
      }),
    db: deps.db ?? {
      upsertUser: upsertOAuthUserFromCli,
      listUsers: listOAuthUsers,
      getUserSummary: getOAuthUserSummary,
      getUserTokens: getUserOAuthTokens,
      clearUserTokens: clearUserOAuthTokens,
      getSelectedChannelId,
      setSelectedChannelId,
    },
    startLoopbackCallbackServer: deps.startLoopbackCallbackServer ?? createLoopbackCallbackServer,
  };

  async function resolveEffectiveCredentialRef(args: {
    explicit?: CredentialRef;
  }): Promise<CredentialRef> {
    if (args.explicit) {
      return args.explicit;
    }

    const context = await resolvedDeps.storage.read();
    if (!context) {
      throw authUserNotFound("No active auth context. Run `auth login` first.", {
        reason: "active_user_missing",
      });
    }

    const user = await resolvedDeps.db.getUserSummary(context.activeUserId);
    if (!user) {
      throw authUserNotFound("Active auth user does not exist in local storage", {
        userId: context.activeUserId,
      });
    }

    return { userId: user.userId };
  }

  async function resolveWriteChannelSnapshot(args: {
    effectiveCredentialRef: { userId: string };
  }): Promise<{ writeChannel: WriteChannelContext; selectedChannelId: string | null }> {
    const selectedChannelId = await resolvedDeps.db.getSelectedChannelId(args.effectiveCredentialRef.userId);

    let credentials: ResolvedCredentials | undefined;
    try {
      credentials = await resolvedDeps.credentialResolver({
        credentialRef: args.effectiveCredentialRef,
        requiredScopes: [YOUTUBE_READ_SCOPE],
      });
    } catch {
      credentials = undefined;
    }

    if (credentials) {
      return {
        writeChannel: await resolvedDeps.writeContext.getWriteChannelContext({
          credentialRef: args.effectiveCredentialRef,
          credentials,
        }),
        selectedChannelId,
      };
    }

    return {
      writeChannel: fallbackWriteChannelContext({
        selectedChannelId,
        reason: "auth_unavailable",
      }),
      selectedChannelId,
    };
  }

  return {
    resolveEffectiveCredentialRef,

    async login(args?: { timeoutMs?: number }) {
      const timeoutMs = args?.timeoutMs ?? 120_000;
      const state = resolvedDeps.oauth.generateState();
      const pkce = resolvedDeps.oauth.generatePkcePair();

      const callbackServer = await resolvedDeps.startLoopbackCallbackServer({
        expectedState: state,
        timeoutMs,
      });

      const authUrl = resolvedDeps.oauth.buildLoopbackAuthUrl({
        redirectUri: callbackServer.redirectUri,
        state,
        codeChallenge: pkce.challenge,
      });
      console.log("\nOAuth URL:\n", authUrl, "\n");
      await resolvedDeps.openBrowser(authUrl);
      const callback = await callbackServer.waitForCallback;

      const tokenSet = await resolvedDeps.oauth.exchangeAuthCode({
        redirectUri: callbackServer.redirectUri,
        code: callback.code,
        codeVerifier: pkce.verifier,
      });

      const identity = await resolvedDeps.oauth.fetchIdentity({
        accessToken: tokenSet.accessToken,
        idToken: tokenSet.idToken,
      });

      await persistAuthenticatedUser({
        identity,
        tokens: tokenSet,
        deps: resolvedDeps,
      });

      const summary = await resolvedDeps.db.getUserSummary(identity.userId);
      if (!summary) {
        throw authUserNotFound("Authenticated user could not be persisted", {
          userId: identity.userId,
        });
      }

      return {
        method: "loopback" as const,
        user: toAuthUserSummary(summary, identity.userId),
      };
    },

    async loginDevice(args?: { onPending?: (data: DeviceAuthorizationStart) => void }) {
      const start = await resolvedDeps.oauth.startDeviceAuthorization();
      args?.onPending?.(start);

      const tokenSet = await resolvedDeps.oauth.pollDeviceAuthorizationToken({
        deviceCode: start.deviceCode,
        intervalSeconds: start.interval,
        expiresInSeconds: start.expiresIn,
      });

      const identity = await resolvedDeps.oauth.fetchIdentity({
        accessToken: tokenSet.accessToken,
        idToken: tokenSet.idToken,
      });

      await persistAuthenticatedUser({
        identity,
        tokens: tokenSet,
        deps: resolvedDeps,
      });

      const summary = await resolvedDeps.db.getUserSummary(identity.userId);
      if (!summary) {
        throw authUserNotFound("Authenticated user could not be persisted", {
          userId: identity.userId,
        });
      }

      return {
        method: "device" as const,
        user: toAuthUserSummary(summary, identity.userId),
        verification: {
          verificationUrl: start.verificationUrl,
          verificationUrlComplete: start.verificationUrlComplete,
          userCode: start.userCode,
        },
      };
    },

    async whoami() {
      const context = await resolvedDeps.storage.read();
      if (!context) {
        throw authUserNotFound("No active auth context. Run `auth login` first.", {
          reason: "active_user_missing",
        });
      }

      const user = await resolvedDeps.db.getUserSummary(context.activeUserId);
      if (!user) {
        throw authUserNotFound("Active auth user does not exist in local storage", {
          userId: context.activeUserId,
        });
      }

      const effectiveCredentialRef = { userId: user.userId };
      const { writeChannel } = await resolveWriteChannelSnapshot({
        effectiveCredentialRef,
      });

      return {
        ...toAuthUserSummary(user, context.activeUserId),
        activeWriteChannel: writeChannel.activeWriteChannel,
        selectedChannelId: writeChannel.selectedChannelId,
        alignment: writeChannel.alignment,
        requiresReauth: writeChannel.requiresReauth,
        knownChannels: writeChannel.knownChannels,
        writeChannel,
        effectiveCredentialRef,
      };
    },

    async selectUser(args: { userId: string }): Promise<SelectUserResult> {
      const parsed = selectUserInputSchema.safeParse(args);
      if (!parsed.success) {
        throw new DomainError({
          code: "validation_failed",
          message: "Invalid user selection input",
          details: toValidationIssues(parsed.error),
        });
      }

      const nextUser = await resolvedDeps.db.getUserSummary(parsed.data.userId);
      if (!nextUser) {
        throw authUserNotFound("Requested auth user does not exist in local storage", {
          userId: parsed.data.userId,
          affectsRemoteOAuth: false,
        });
      }

      const previousContext = await resolvedDeps.storage.read();
      const previousActiveUserId = previousContext?.activeUserId ?? null;
      const changed = previousActiveUserId !== nextUser.userId;

      await resolvedDeps.storage.write({ activeUserId: nextUser.userId });

      const effectiveCredentialRef = { userId: nextUser.userId };
      const { writeChannel } = await resolveWriteChannelSnapshot({
        effectiveCredentialRef,
      });

      return {
        activeUser: toAuthUserSummary(nextUser, nextUser.userId),
        previousActiveUserId,
        changed,
        effectiveCredentialRef,
        writeChannel,
        activeWriteChannel: writeChannel.activeWriteChannel,
        selectedChannelId: writeChannel.selectedChannelId,
        alignment: writeChannel.alignment,
        requiresReauth: writeChannel.requiresReauth,
        affectsRemoteOAuth: false,
      };
    },

    async listKnownWriteChannels(args?: { credentialRef?: CredentialRef }) {
      const effectiveCredentialRef = await resolveEffectiveCredentialRef({
        explicit: args?.credentialRef,
      });

      const selectedChannelId =
        "userId" in effectiveCredentialRef
          ? await resolvedDeps.db.getSelectedChannelId(effectiveCredentialRef.userId)
          : null;

      let credentials: ResolvedCredentials | undefined;
      try {
        credentials = await resolvedDeps.credentialResolver({
          credentialRef: effectiveCredentialRef,
          requiredScopes: [YOUTUBE_READ_SCOPE],
        });
      } catch {
        credentials = undefined;
      }

      if (!credentials) {
        const fallback = fallbackWriteChannelContext({
          selectedChannelId,
          reason: "auth_unavailable",
        });

        return {
          knownChannels: fallback.knownChannels,
          alignment: fallback.alignment,
          activeWriteChannel: fallback.activeWriteChannel,
          selectedChannelId: fallback.selectedChannelId,
          expectedChannelId: fallback.expectedChannelId,
          source: fallback.source,
          requiresReauth: fallback.requiresReauth,
        };
      }

      return resolvedDeps.writeContext.listKnownChannels({
        credentialRef: effectiveCredentialRef,
        credentials,
      });
    },

    async selectWriteChannel(args: { channelId: string; credentialRef?: CredentialRef }) {
      const parsed = selectWriteChannelInputSchema.safeParse({
        channelId: args.channelId,
        credentialRef: args.credentialRef,
      });

      if (!parsed.success) {
        throw new DomainError({
          code: "validation_failed",
          message: "Invalid write channel selection input",
          details: toValidationIssues(parsed.error),
        });
      }

      const effectiveCredentialRef = await resolveEffectiveCredentialRef({
        explicit: parsed.data.credentialRef as CredentialRef | undefined,
      });

      if (!("userId" in effectiveCredentialRef)) {
        throw new DomainError({
          code: "validation_failed",
          message: "write_channel_select requires userId-based credentialRef",
          details: [
            {
              path: "credentialRef.userId",
              message: "Persisting selected channel requires a local user profile",
              code: "custom",
            },
          ],
        });
      }

      let credentials: ResolvedCredentials | undefined;
      try {
        credentials = await resolvedDeps.credentialResolver({
          credentialRef: effectiveCredentialRef,
          requiredScopes: [YOUTUBE_READ_SCOPE],
        });
      } catch {
        credentials = undefined;
      }

      return resolvedDeps.writeContext.selectWriteChannel({
        credentialRef: effectiveCredentialRef,
        channelId: parsed.data.channelId,
        credentials,
      });
    },

    async listUsers() {
      const context = await resolvedDeps.storage.read();
      const activeUserId = context?.activeUserId ?? null;

      const users = await resolvedDeps.db.listUsers();
      return {
        users: users.map((user) => toAuthUserSummary(user, activeUserId)),
      };
    },

    async logout() {
      await resolvedDeps.storage.clear();
      return { loggedOut: true };
    },

    async revoke(args?: { userId?: string }) {
      let targetUserId = args?.userId;

      if (!targetUserId) {
        const resolved = await resolveEffectiveCredentialRef({ explicit: undefined });
        if (!("userId" in resolved)) {
          throw authUserNotFound("No active user is available for revoke", {
            reason: "active_user_missing",
          });
        }

        targetUserId = resolved.userId;
      }

      const tokenRow = await resolvedDeps.db.getUserTokens(targetUserId);
      if (!tokenRow) {
        throw authUserNotFound("Cannot revoke non-existing user", { userId: targetUserId });
      }

      const tokenForRevoke = tokenRow.refreshToken ?? tokenRow.accessToken;
      if (!tokenForRevoke) {
        throw authUserNotFound("No OAuth token available to revoke for this user", {
          userId: targetUserId,
        });
      }

      await resolvedDeps.oauth.revokeToken(tokenForRevoke);
      await resolvedDeps.db.clearUserTokens(targetUserId);

      const context = await resolvedDeps.storage.read();
      const clearedActive = context?.activeUserId === targetUserId;
      if (clearedActive) {
        await resolvedDeps.storage.clear();
      }

      return {
        revoked: true,
        userId: targetUserId,
        clearedActive,
      };
    },
  };
}

export type CliAuthService = ReturnType<typeof createCliAuthService>;
