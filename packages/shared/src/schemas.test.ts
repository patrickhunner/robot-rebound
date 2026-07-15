import { describe, expect, it } from "vitest";
import { animationSpeedCommandSchema, reviewPlaybackSchema, reviewSelectSchema, roomCodeSchema, roomCommandSchema } from "./schemas.js";

describe("room identifiers", () => {
  it("keeps browser join codes at six characters", () => {
    expect(roomCodeSchema.safeParse("ABC234").success).toBe(true);
    expect(roomCodeSchema.safeParse("i-activity-instance").success).toBe(false);
  });

  it("accepts Discord instance ids for commands after joining", () => {
    expect(roomCommandSchema.parse({ code: "i-1526284422557597716-gc-691421046313582722-691421046313582727" })).toEqual({
      code: "i-1526284422557597716-gc-691421046313582722-691421046313582727"
    });
  });

  it("accepts review robot selection and explicit deselection", () => {
    expect(reviewSelectSchema.parse({ code: "ABC234", robot: "silver" }).robot).toBe("silver");
    expect(reviewSelectSchema.parse({ code: "ABC234", robot: null }).robot).toBeNull();
  });

  it("validates animation speeds and playback moves", () => {
    expect(animationSpeedCommandSchema.parse({ code: "ABC234", speed: 5 }).speed).toBe(5);
    expect(animationSpeedCommandSchema.safeParse({ code: "ABC234", speed: 11 }).success).toBe(false);
    expect(reviewPlaybackSchema.parse({ code: "ABC234", moves: [{ robot: "red", direction: "east" }] }).moves).toHaveLength(1);
    expect(reviewPlaybackSchema.safeParse({ code: "ABC234", moves: [] }).success).toBe(false);
  });
});
