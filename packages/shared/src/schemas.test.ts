import { describe, expect, it } from "vitest";
import { roomCodeSchema, roomCommandSchema } from "./schemas.js";

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
});
