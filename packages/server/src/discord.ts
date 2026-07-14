const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
}

export interface DiscordJoinTicket {
  user: DiscordUser;
  instanceId: string;
  expiresAt: number;
}

type DiscordTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

type DiscordActivityInstance = {
  application_id?: string;
  instance_id?: string;
  users?: string[];
  participants?: string[];
};

export interface DiscordExchangeInput {
  clientId: string;
  clientSecret: string;
  botToken: string;
  code: string;
  instanceId: string;
  redirectUri?: string;
  now?: number;
  fetchImpl?: typeof fetch;
}

export async function exchangeDiscordCode(input: DiscordExchangeInput): Promise<{ accessToken: string; ticket: DiscordJoinTicket }> {
  const now = input.now ?? Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const tokenResponse = await fetchImpl(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {})
    })
  });
  const token = await readJson<DiscordTokenResponse>(tokenResponse, "Discord authorization exchange failed");
  const user = await fetchDiscordUser(token.access_token, fetchImpl);
  const instance = await fetchDiscordActivityInstance(input.clientId, input.instanceId, input.botToken, fetchImpl);
  const participants = new Set(instance.users ?? instance.participants ?? []);
  if (!participants.has(user.id)) throw new Error("That Discord account is not in this activity instance");
  return {
    accessToken: token.access_token,
    ticket: {
      user,
      instanceId: input.instanceId,
      expiresAt: now + token.expires_in * 1000
    }
  };
}

export async function fetchDiscordUser(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<DiscordUser> {
  const response = await fetchImpl(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return readJson<DiscordUser>(response, "Unable to read Discord account");
}

export async function fetchDiscordActivityInstance(clientId: string, instanceId: string, botToken: string, fetchImpl: typeof fetch = fetch): Promise<DiscordActivityInstance> {
  const response = await fetchImpl(`${DISCORD_API_BASE}/applications/${clientId}/activity-instances/${instanceId}`, {
    headers: { Authorization: `Bot ${botToken}` }
  });
  return readJson<DiscordActivityInstance>(response, "Unable to verify Discord activity instance");
}

async function readJson<T>(response: Response, fallbackError: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body ? `${fallbackError}: ${body}` : fallbackError);
  }
  return response.json() as Promise<T>;
}
