import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { DomainError } from "@/lib/video-metadata/contracts";
import { buildBrowserOpenCommand, createCliAuthService, openBrowserForCliOAuth } from "./service";
import type { ActiveAuthStorage } from "./storage";

function makeStorageStub(initialUserId: string | null = null): ActiveAuthStorage {
  let current =
    initialUserId === null
      ? null
      : {
          activeUserId: initialUserId,
          updatedAt: new Date().toISOString(),
          version: 1 as const,
        };

  return {
    read: async () => current,
    write: async ({ activeUserId }) => {
      current = {
        activeUserId,
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      return current;
    },
    clear: async () => {
      current = null;
    },
  };
}

test("resolveEffectiveCredentialRef keeps explicit credential precedence", async () => {
  const service = createCliAuthService({
    storage: makeStorageStub("active-user"),
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async () => null,
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
  });

  const resolved = await service.resolveEffectiveCredentialRef({
    explicit: { userId: "explicit-user" },
  });
  assert.deepEqual(resolved, { userId: "explicit-user" });
});

test("resolveEffectiveCredentialRef falls back to active context", async () => {
  const service = createCliAuthService({
    storage: makeStorageStub("active-user"),
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
  });

  const resolved = await service.resolveEffectiveCredentialRef({});
  assert.deepEqual(resolved, { userId: "active-user" });
});

test("resolveEffectiveCredentialRef fails with AUTH_USER_NOT_FOUND when active user is missing", async () => {
  const service = createCliAuthService({
    storage: makeStorageStub("active-user"),
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async () => null,
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
  });

  await assert.rejects(
    () => service.resolveEffectiveCredentialRef({}),
    (error: unknown) =>
      error instanceof DomainError && error.code === "AUTH_USER_NOT_FOUND"
  );
});

test("whoami returns enriched write-channel context without secrets", async () => {
  const service = createCliAuthService({
    storage: makeStorageStub("active-user"),
    credentialResolver: async () => ({
      credentialRef: { userId: "active-user" },
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
      scopeSet: new Set(["https://www.googleapis.com/auth/youtube.readonly"]),
    }),
    writeContext: {
      getWriteChannelContext: async () => ({
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        selectedChannelId: "UC_SELECTED",
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        knownChannels: [
          {
            id: "UC_ACTIVE",
            title: "Active channel",
            source: "active",
            isActive: true,
            isSelected: false,
          },
          {
            id: "UC_SELECTED",
            title: null,
            source: "selected",
            isActive: false,
            isSelected: true,
          },
        ],
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: "Selected expected channel does not match the active OAuth channel.",
          recommendedAction: "Reauthenticate with the expected channel or select active.",
        },
        requiresReauth: true,
      }),
      listKnownChannels: async () => ({
        knownChannels: [],
        alignment: {
          status: "unresolved",
          requiresReauth: false,
          message: "No expected write channel is configured yet.",
          recommendedAction: "Select the expected channel before running sensitive write operations.",
        },
        activeWriteChannel: null,
        selectedChannelId: null,
        expectedChannelId: null,
        source: "missing",
        requiresReauth: false,
      }),
      selectWriteChannel: async () => ({
        selectedChannelId: "UC_SELECTED",
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: "Selected expected channel does not match the active OAuth channel.",
          recommendedAction: "Reauthenticate with the expected channel or select active.",
        },
        knownChannels: [],
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select active.",
      }),
    },
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => "UC_SELECTED",
      setSelectedChannelId: async () => undefined,
    },
  });

  const result = await service.whoami();
  assert.equal(result.userId, "active-user");
  assert.deepEqual(result.effectiveCredentialRef, { userId: "active-user" });
  assert.deepEqual(result.activeWriteChannel, { id: "UC_ACTIVE", title: "Active channel" });
  assert.equal(result.selectedChannelId, "UC_SELECTED");
  assert.equal(result.writeChannel.alignment.status, "mismatch");
  assert.equal(result.writeChannel.requiresReauth, true);
});

test("loginDevice persists user and marks active context", async () => {
  const storage = makeStorageStub();
  let upsertedUserId: string | null = null;

  const service = createCliAuthService({
    storage,
    oauth: {
      generateState: () => "state",
      generatePkcePair: () => ({ verifier: "verifier", challenge: "challenge" }),
      buildLoopbackAuthUrl: () => "http://example.com",
      exchangeAuthCode: async () => {
        throw new Error("not used in this test");
      },
      fetchIdentity: async () => ({
        userId: "user-device",
        email: "device@example.com",
        name: null,
        image: null,
      }),
      startDeviceAuthorization: async () => ({
        deviceCode: "device-code",
        userCode: "USER-CODE",
        verificationUrl: "https://example.com/verify",
        verificationUrlComplete: null,
        expiresIn: 300,
        interval: 5,
      }),
      pollDeviceAuthorizationToken: async () => ({
        accessToken: "access",
        refreshToken: "refresh",
        tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
        scope: "openid email profile",
        idToken: null,
      }),
      revokeToken: async () => undefined,
    },
    db: {
      upsertUser: async (input) => {
        upsertedUserId = input.userId;
      },
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
  });

  const result = await service.loginDevice();
  assert.equal(result.method, "device");
  assert.equal(result.user.userId, "user-device");
  assert.equal(upsertedUserId, "user-device");

  const active = await storage.read();
  assert.equal(active?.activeUserId, "user-device");
});

test("buildBrowserOpenCommand uses rundll32 FileProtocolHandler on Windows", () => {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=client&scope=openid%20email&state=abc";

  const command = buildBrowserOpenCommand(url, "win32");

  assert.equal(command.command, "rundll32.exe");
  assert.deepEqual(command.args, ["url.dll,FileProtocolHandler", url]);
  assert.deepEqual(command.options, {
    stdio: "ignore",
    detached: true,
  });
});

test("buildBrowserOpenCommand passes Windows OAuth URL as a separate argument", () => {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=client&scope=openid%20email&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A8787%2Fcallback&prompt=consent";

  const command = buildBrowserOpenCommand(url, "win32");

  assert.equal(command.args.at(-2), "url.dll,FileProtocolHandler");
  assert.equal(command.args.at(-1), url);
  assert.ok(!command.args.at(-2)?.includes(url));
});

test("buildBrowserOpenCommand preserves macOS and Linux openers", () => {
  const url = "https://example.com/oauth?state=abc&scope=openid";

  assert.deepEqual(buildBrowserOpenCommand(url, "darwin"), {
    command: "open",
    args: [url],
    options: {
      stdio: "ignore",
      detached: true,
    },
  });
  assert.deepEqual(buildBrowserOpenCommand(url, "linux"), {
    command: "xdg-open",
    args: [url],
    options: {
      stdio: "ignore",
      detached: true,
    },
  });
});

test("openBrowserForCliOAuth emits opt-in debug details before spawn", async () => {
  const originalDebug = process.env.CLI_OAUTH_OPENER_DEBUG;
  process.env.CLI_OAUTH_OPENER_DEBUG = "1";
  const logs: string[] = [];
  const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
  child.pid = 1234;
  child.unref = () => undefined;
  let receivedCommand: string | null = null;
  let receivedArgs: readonly string[] | null = null;
  const spawnProcess = ((command: string, args: readonly string[]) => {
    receivedCommand = command;
    receivedArgs = args;
    return child;
  }) as typeof import("node:child_process").spawn;

  try {
    const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=client&scope=openid%20email&state=abc";

    await openBrowserForCliOAuth(url, {
      spawnProcess,
      logger: (message) => logs.push(message),
    });

    assert.equal(receivedCommand, "rundll32.exe");
    assert.equal(receivedArgs?.at(-2), "url.dll,FileProtocolHandler");
    assert.equal(receivedArgs?.at(-1), url);
    const beforeSpawn = JSON.parse(logs[0]);
    assert.equal(beforeSpawn.scope, "cli-oauth-opener");
    assert.equal(beforeSpawn.event, "before-spawn");
    assert.equal(beforeSpawn.command, "rundll32.exe");
    assert.equal(beforeSpawn.oauthUrl, url);
    assert.equal(beforeSpawn.platform.platform, process.platform);
    assert.match(beforeSpawn.reproductionCommand, /^rundll32\.exe /);
    assert.match(beforeSpawn.reproductionCommand, /url\.dll,FileProtocolHandler/);
    assert.match(beforeSpawn.reproductionCommand, /https:\/\/accounts\.google\.com/);
    assert.equal(JSON.parse(logs.at(-1) ?? "{}").event, "opener-promise-resolve");
  } finally {
    if (originalDebug === undefined) {
      delete process.env.CLI_OAUTH_OPENER_DEBUG;
    } else {
      process.env.CLI_OAUTH_OPENER_DEBUG = originalDebug;
    }
  }
});

test("openBrowserForCliOAuth debug logs child process lifecycle events", async () => {
  const originalDebug = process.env.CLI_OAUTH_OPENER_DEBUG;
  process.env.CLI_OAUTH_OPENER_DEBUG = "1";
  const logs: string[] = [];
  const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
  child.pid = 9876;
  child.unref = () => undefined;
  const spawnProcess = (() => child) as typeof import("node:child_process").spawn;

  try {
    await openBrowserForCliOAuth("https://example.com/oauth?state=abc", {
      spawnProcess,
      logger: (message) => logs.push(message),
    });

    child.emit("spawn");
    child.emit("error", Object.assign(new Error("opener failed"), { code: "ENOENT" }));
    child.emit("exit", 0, null);
    child.emit("close", 0, null);

    const events = logs.map((message) => JSON.parse(message));
    assert.deepEqual(events.map((entry) => entry.event), [
      "before-spawn",
      "opener-promise-resolve",
      "spawn",
      "error",
      "exit",
      "close",
    ]);
    assert.equal(events.find((entry) => entry.event === "spawn")?.childPid, 9876);
    assert.equal(events.find((entry) => entry.event === "error")?.error.code, "ENOENT");
    assert.equal(events.find((entry) => entry.event === "error")?.error.message, "opener failed");
    assert.equal(events.find((entry) => entry.event === "exit")?.code, 0);
    assert.equal(events.find((entry) => entry.event === "close")?.code, 0);
  } finally {
    if (originalDebug === undefined) {
      delete process.env.CLI_OAUTH_OPENER_DEBUG;
    } else {
      process.env.CLI_OAUTH_OPENER_DEBUG = originalDebug;
    }
  }
});

test("openBrowserForCliOAuth stays quiet when opener debug is disabled", async () => {
  const originalDebug = process.env.CLI_OAUTH_OPENER_DEBUG;
  delete process.env.CLI_OAUTH_OPENER_DEBUG;
  const logs: string[] = [];
  const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
  child.pid = 4321;
  child.unref = () => undefined;
  const spawnProcess = (() => child) as typeof import("node:child_process").spawn;

  try {
    await openBrowserForCliOAuth("https://example.com/oauth?state=abc", {
      spawnProcess,
      logger: (message) => logs.push(message),
    });

    child.emit("spawn");
    child.emit("exit", 0, null);
    child.emit("close", 0, null);

    assert.deepEqual(logs, []);
  } finally {
    if (originalDebug === undefined) {
      delete process.env.CLI_OAUTH_OPENER_DEBUG;
    } else {
      process.env.CLI_OAUTH_OPENER_DEBUG = originalDebug;
    }
  }
});

test("login uses fixed loopback redirect URI from callback server", async () => {
  const storage = makeStorageStub();
  let receivedRedirectUri: string | null = null;
  let openedUrl: string | null = null;

  const service = createCliAuthService({
    storage,
    openBrowser: async (url) => {
      openedUrl = url;
    },
    oauth: {
      generateState: () => "state",
      generatePkcePair: () => ({ verifier: "verifier", challenge: "challenge" }),
      buildLoopbackAuthUrl: ({ redirectUri }: { redirectUri: string }) => {
        receivedRedirectUri = redirectUri;
        return "http://example.com";
      },
      exchangeAuthCode: async () => ({
        accessToken: "access",
        refreshToken: "refresh",
        tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
        scope: "openid email profile",
        idToken: null,
      }),
      fetchIdentity: async () => ({
        userId: "user-loopback",
        email: "loopback@example.com",
        name: null,
        image: null,
      }),
      startDeviceAuthorization: async () => {
        throw new Error("not used in this test");
      },
      pollDeviceAuthorizationToken: async () => {
        throw new Error("not used in this test");
      },
      revokeToken: async () => undefined,
    },
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
    startLoopbackCallbackServer: async () => ({
      redirectUri: "http://127.0.0.1:8787",
      waitForCallback: Promise.resolve({ code: "auth-code", state: "state" }),
    }),
  });

  const result = await service.login();
  assert.equal(result.method, "loopback");
  assert.equal(receivedRedirectUri, "http://127.0.0.1:8787");
  assert.equal(openedUrl, "http://example.com");
});

test("revoke fails if remote revoke fails and keeps local tokens untouched", async () => {
  let clearTokensCalled = false;
  const service = createCliAuthService({
    storage: makeStorageStub("active-user"),
    oauth: {
      generateState: () => "state",
      generatePkcePair: () => ({ verifier: "verifier", challenge: "challenge" }),
      buildLoopbackAuthUrl: () => "http://example.com",
      exchangeAuthCode: async () => {
        throw new Error("not used in this test");
      },
      fetchIdentity: async () => ({
        userId: "active-user",
        email: "active@example.com",
        name: null,
        image: null,
      }),
      startDeviceAuthorization: async () => {
        throw new Error("not used in this test");
      },
      pollDeviceAuthorizationToken: async () => {
        throw new Error("not used in this test");
      },
      revokeToken: async () => {
        throw new Error("remote revoke failed");
      },
    },
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: "active@example.com",
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => ({
        userId: "active-user",
        accessToken: "access",
        refreshToken: "refresh",
        tokenExpiry: null,
        scope: null,
      }),
      clearUserTokens: async () => {
        clearTokensCalled = true;
      },
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
  });

  await assert.rejects(() => service.revoke(), /remote revoke failed/);
  assert.equal(clearTokensCalled, false);
});

test("listKnownWriteChannels returns minimal-safe known channels from write-context", async () => {
  const service = createCliAuthService({
    storage: makeStorageStub("active-user"),
    credentialResolver: async () => ({
      credentialRef: { userId: "active-user" },
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
      scopeSet: new Set(["https://www.googleapis.com/auth/youtube.readonly"]),
    }),
    writeContext: {
      getWriteChannelContext: async () => {
        throw new Error("not used");
      },
      listKnownChannels: async () => ({
        knownChannels: [
          {
            id: "UC_ACTIVE",
            title: "Active channel",
            source: "active",
            isActive: true,
            isSelected: false,
          },
          {
            id: "UC_SELECTED",
            title: null,
            source: "selected",
            isActive: false,
            isSelected: true,
          },
        ],
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: "Selected expected channel does not match the active OAuth channel.",
          recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
        },
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        selectedChannelId: "UC_SELECTED",
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        requiresReauth: true,
      }),
      selectWriteChannel: async () => {
        throw new Error("not used");
      },
    },
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => "UC_SELECTED",
      setSelectedChannelId: async () => undefined,
    },
  });

  const result = await service.listKnownWriteChannels();
  assert.equal(result.knownChannels.length, 2);
  assert.equal(result.alignment.status, "mismatch");
  assert.equal(result.requiresReauth, true);
});

test("selectWriteChannel persists requested channel and returns mismatch state", async () => {
  const service = createCliAuthService({
    storage: makeStorageStub("active-user"),
    credentialResolver: async () => ({
      credentialRef: { userId: "active-user" },
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
      scopeSet: new Set(["https://www.googleapis.com/auth/youtube.readonly"]),
    }),
    writeContext: {
      getWriteChannelContext: async () => {
        throw new Error("not used");
      },
      listKnownChannels: async () => {
        throw new Error("not used");
      },
      selectWriteChannel: async ({ channelId }) => ({
        selectedChannelId: channelId,
        activeWriteChannel: { id: "UC2222222222222222222222", title: "Active channel" },
        expectedChannelId: channelId,
        source: "stored",
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: "Selected expected channel does not match the active OAuth channel.",
          recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
        },
        knownChannels: [],
        requiresReauth: true,
        message: "Selected expected channel does not match the active OAuth channel.",
        recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
      }),
    },
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => "UC_SELECTED",
      setSelectedChannelId: async () => undefined,
    },
  });

  const result = await service.selectWriteChannel({
    channelId: "UC1111111111111111111111",
  });

  assert.equal(result.selectedChannelId, "UC1111111111111111111111");
  assert.equal(result.alignment.status, "mismatch");
  assert.equal(result.requiresReauth, true);
});

test("selectWriteChannel rejects invalid channelId with validation_failed", async () => {
  const service = createCliAuthService({
    storage: makeStorageStub("active-user"),
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
  });

  await assert.rejects(
    () => service.selectWriteChannel({ channelId: "" }),
    (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, "validation_failed");
      return true;
    }
  );
});

test("selectUser switches activeUserId and returns post-switch write-context feedback", async () => {
  const storage = makeStorageStub("user-a");
  const service = createCliAuthService({
    storage,
    credentialResolver: async ({ credentialRef }) => ({
      credentialRef,
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
      scopeSet: new Set(["https://www.googleapis.com/auth/youtube.readonly"]),
    }),
    writeContext: {
      getWriteChannelContext: async ({ credentialRef }) => ({
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        selectedChannelId: "UC_SELECTED",
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        knownChannels: [
          {
            id: "UC_ACTIVE",
            title: "Active channel",
            source: "active",
            isActive: true,
            isSelected: false,
          },
        ],
        alignment: {
          status: "mismatch",
          requiresReauth: true,
          message: `Alignment for ${(credentialRef as { userId: string }).userId}`,
          recommendedAction: "Reauthenticate with the expected channel or select the active channel.",
        },
        requiresReauth: true,
      }),
      listKnownChannels: async () => {
        throw new Error("not used");
      },
      selectWriteChannel: async () => {
        throw new Error("not used");
      },
    },
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => {
        if (userId !== "user-b") return null;
        return {
          userId,
          email: "user-b@example.com",
          name: null,
          tokenExpiry: null,
          hasRefreshToken: true,
        };
      },
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => "UC_SELECTED",
      setSelectedChannelId: async () => undefined,
    },
  });

  const result = await service.selectUser({ userId: "user-b" });

  assert.equal(result.activeUser.userId, "user-b");
  assert.equal(result.previousActiveUserId, "user-a");
  assert.equal(result.changed, true);
  assert.equal(result.affectsRemoteOAuth, false);
  assert.equal(result.writeChannel.alignment.status, "mismatch");

  const nextContext = await storage.read();
  assert.equal(nextContext?.activeUserId, "user-b");
});

test("selectUser fails with AUTH_USER_NOT_FOUND and does not persist changes", async () => {
  const storage = makeStorageStub("user-a");
  const service = createCliAuthService({
    storage,
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async () => null,
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
  });

  await assert.rejects(
    () => service.selectUser({ userId: "missing-user" }),
    (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, "AUTH_USER_NOT_FOUND");
      return true;
    }
  );

  const nextContext = await storage.read();
  assert.equal(nextContext?.activeUserId, "user-a");
});

test("selectUser is idempotent and keeps changed=false for same active user", async () => {
  const storage = makeStorageStub("user-a");
  const service = createCliAuthService({
    storage,
    credentialResolver: async ({ credentialRef }) => ({
      credentialRef,
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
      scopeSet: new Set(["https://www.googleapis.com/auth/youtube.readonly"]),
    }),
    writeContext: {
      getWriteChannelContext: async () => ({
        activeWriteChannel: { id: "UC_ACTIVE", title: "Active channel" },
        selectedChannelId: "UC_SELECTED",
        expectedChannelId: "UC_SELECTED",
        source: "stored",
        knownChannels: [],
        alignment: {
          status: "matched",
          requiresReauth: false,
          message: "Selected expected channel matches the active OAuth channel.",
          recommendedAction: null,
        },
        requiresReauth: false,
      }),
      listKnownChannels: async () => {
        throw new Error("not used");
      },
      selectWriteChannel: async () => {
        throw new Error("not used");
      },
    },
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => "UC_SELECTED",
      setSelectedChannelId: async () => undefined,
    },
  });

  const result = await service.selectUser({ userId: "user-a" });
  assert.equal(result.changed, false);
  assert.equal(result.previousActiveUserId, "user-a");
});

test("selectUser updates implicit fallback used by resolveEffectiveCredentialRef", async () => {
  const storage = makeStorageStub("user-a");
  const service = createCliAuthService({
    storage,
    credentialResolver: async ({ credentialRef }) => ({
      credentialRef,
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
      scopeSet: new Set(["https://www.googleapis.com/auth/youtube.readonly"]),
    }),
    writeContext: {
      getWriteChannelContext: async () => ({
        activeWriteChannel: null,
        selectedChannelId: null,
        expectedChannelId: null,
        source: "missing",
        knownChannels: [],
        alignment: {
          status: "unresolved",
          requiresReauth: false,
          message: "No expected write channel is configured yet.",
          recommendedAction: "Select the expected channel before running sensitive write operations.",
        },
        requiresReauth: false,
      }),
      listKnownChannels: async () => {
        throw new Error("not used");
      },
      selectWriteChannel: async () => {
        throw new Error("not used");
      },
    },
    db: {
      upsertUser: async () => undefined,
      listUsers: async () => [],
      getUserSummary: async (userId: string) => ({
        userId,
        email: `${userId}@example.com`,
        name: null,
        tokenExpiry: null,
        hasRefreshToken: true,
      }),
      getUserTokens: async () => null,
      clearUserTokens: async () => undefined,
      getSelectedChannelId: async () => null,
      setSelectedChannelId: async () => undefined,
    },
  });

  await service.selectUser({ userId: "user-b" });
  const resolved = await service.resolveEffectiveCredentialRef({});

  assert.deepEqual(resolved, { userId: "user-b" });
});
