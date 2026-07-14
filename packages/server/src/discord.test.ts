import { describe, expect, it, vi } from "vitest";
import { exchangeDiscordCode } from "./discord.js";

describe("Discord auth helpers", () => {
  it("exchanges a code, validates the user, and checks the activity instance", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600, token_type: "Bearer", scope: "identify" }), { status: 200 });
      }
      if (url.endsWith("/users/@me")) {
        return new Response(JSON.stringify({ id: "user-1", username: "Ada", global_name: "Ada Lovelace" }), { status: 200 });
      }
      if (url.includes("/activity-instances/")) {
        return new Response(JSON.stringify({ application_id: "app-1", instance_id: "instance-1", users: ["user-1"] }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await exchangeDiscordCode({
      clientId: "app-1",
      clientSecret: "secret",
      botToken: "bot",
      code: "auth-code",
      instanceId: "instance-1",
      now: 1_000,
      fetchImpl
    });

    expect(result.accessToken).toBe("access-token");
    expect(result.ticket.user.id).toBe("user-1");
    expect(result.ticket.user.global_name).toBe("Ada Lovelace");
    expect(result.ticket.instanceId).toBe("instance-1");
    expect(result.ticket.expiresAt).toBe(3_601_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects accounts that are not listed in the activity instance", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600, token_type: "Bearer", scope: "identify" }), { status: 200 });
      }
      if (url.endsWith("/users/@me")) {
        return new Response(JSON.stringify({ id: "user-1", username: "Ada", global_name: null }), { status: 200 });
      }
      if (url.includes("/activity-instances/")) {
        return new Response(JSON.stringify({ application_id: "app-1", instance_id: "instance-1", users: [] }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    await expect(exchangeDiscordCode({
      clientId: "app-1",
      clientSecret: "secret",
      botToken: "bot",
      code: "auth-code",
      instanceId: "instance-1",
      fetchImpl
    })).rejects.toThrow(/not in this activity instance/);
  });
});
