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

let bootstrapPromise: Promise<DiscordBootstrapSession> | null = null;

export function isDiscordActivity(): boolean {
  return typeof window !== "undefined" && window.location.hostname.endsWith(".discordsays.com");
}

export function bootstrapDiscordSession(): Promise<DiscordBootstrapSession> {
  bootstrapPromise ??= runDiscordBootstrap();
  return bootstrapPromise;
}

async function runDiscordBootstrap(): Promise<DiscordBootstrapSession> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID?.trim();
  if (!clientId) throw new Error("VITE_DISCORD_CLIENT_ID is not configured");
  if (!isDiscordActivity()) throw new Error("Discord bootstrap was attempted outside an Activity");
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
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
  await sdk.commands.authenticate({ access_token: payload.accessToken });
  const displayName = (payload.user.globalName ?? payload.user.username).trim() || "Player";
  return {
    instanceId: sdk.instanceId,
    joinToken: payload.joinToken,
    user: payload.user,
    displayName
  };
}
