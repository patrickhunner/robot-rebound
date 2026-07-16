import { describe, expect, it, vi } from "vitest";
import { waitForServer, type DiscordBootstrapProgress } from "./discord";

describe("Discord server warmup", () => {
  it("retries transient failures until the server becomes healthy", async () => {
    let now = 0;
    const checkHealth = vi.fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const progress: DiscordBootstrapProgress[] = [];

    await waitForServer((next) => progress.push(next), {
      checkHealth,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
      maxWaitMs: 10_000
    });

    expect(checkHealth).toHaveBeenCalledTimes(3);
    expect(progress).toEqual(["waking"]);
  });

  it("stops retrying at the configured deadline", async () => {
    let now = 0;
    const checkHealth = vi.fn().mockResolvedValue(false);

    await expect(waitForServer(undefined, {
      checkHealth,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
      maxWaitMs: 2_500
    })).rejects.toThrow(/still waking up/i);

    expect(now).toBe(2_500);
    expect(checkHealth).toHaveBeenCalledTimes(2);
  });
});
