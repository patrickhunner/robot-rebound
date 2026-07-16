import { DiscordSDK } from "@discord/embedded-app-sdk";

type DiscordJoinResponse = {
  ok: boolean;
  error?: string;
  accessToken?: string;
  joinToken?: string;
  user?: { id: string; username: string; globalName: string | null };
};

export interface DiscordBootstrapSession {
  instanceId: string;
  joinToken: string;
  user: { id: string; username: string; globalName: string | null };
  displayName: string;
}

export type DiscordBootstrapProgress = "waking" | "authenticating" | "connecting";

interface ServerWarmupOptions {
  checkHealth?: () => Promise<boolean>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  maxWaitMs?: number;
}

let bootstrapPromise: Promise<DiscordBootstrapSession> | null = null;
const serverReadyListeners = new Set<() => void>();

export function isDiscordActivity(): boolean {
  return typeof window !== "undefined" && window.location.hostname.endsWith(".discordsays.com");
}

export function bootstrapDiscordSession(onProgress: (progress: DiscordBootstrapProgress) => void = () => undefined): Promise<DiscordBootstrapSession> {
  bootstrapPromise ??= runDiscordBootstrap(onProgress).catch((error) => {
    bootstrapPromise = null;
    throw error;
  });
  return bootstrapPromise;
}

export async function waitForServer(onProgress: (progress: DiscordBootstrapProgress) => void = () => undefined, options: ServerWarmupOptions = {}): Promise<void> {
  const usesSharedHealthCheck = options.checkHealth === undefined;
  const checkHealth = options.checkHealth ?? pingServerNow;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.maxWaitMs ?? 120_000);
  let delay = 1_000;
  let announceReady: (() => void) | undefined;
  const externallyReady = new Promise<boolean>((resolve) => {
    announceReady = () => resolve(true);
  });
  if (usesSharedHealthCheck && announceReady) serverReadyListeners.add(announceReady);
  onProgress("waking");
  try {
    while (now() < deadline) {
      try {
        if (await Promise.race([checkHealth(), externallyReady])) return;
      } catch {
        // A sleeping Render instance commonly closes or times out early requests.
      }
      const remaining = deadline - now();
      if (remaining <= 0) break;
      if (await Promise.race([sleep(Math.min(delay, remaining)).then(() => false), externallyReady])) return;
      delay = Math.min(Math.ceil(delay * 1.5), 5_000);
    }
  } finally {
    if (announceReady) serverReadyListeners.delete(announceReady);
  }
  throw new Error("The game server is still waking up. Please try again.");
}

export async function pingServerNow(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`/health?wake=${Date.now()}`, { cache: "no-store", signal: controller.signal });
    if (response.ok) {
      for (const listener of serverReadyListeners) listener();
      return true;
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function runDiscordBootstrap(onProgress: (progress: DiscordBootstrapProgress) => void): Promise<DiscordBootstrapSession> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();
  if (!clientId) throw new Error("VITE_DISCORD_CLIENT_ID is not configured");
  if (!isDiscordActivity()) throw new Error("Discord bootstrap was attempted outside an Activity");
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  await waitForServer(onProgress);
  onProgress("authenticating");
  const state = crypto.randomUUID();
  const authorization = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state,
    prompt: "none",
    scope: ["identify"]
  }) as { code?: string };
  if (!authorization.code) throw new Error("Discord did not return an authorization code");
  const response = await fetch("/api/discord/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: authorization.code, instanceId: sdk.instanceId })
  });
  const payload = await response.json() as DiscordJoinResponse;
  if (!response.ok || !payload.ok || !payload.accessToken || !payload.joinToken || !payload.user) {
    throw new Error(payload.error ?? "Could not authenticate with Discord");
  }
  onProgress("connecting");
  await sdk.commands.authenticate({ access_token: payload.accessToken });
  const displayName = (payload.user.globalName ?? payload.user.username).trim() || "Player";
  return {
    instanceId: sdk.instanceId,
    joinToken: payload.joinToken,
    user: payload.user,
    displayName
  };
}
