import { z } from "zod";

export const nameSchema = z.string().trim().min(1, "Enter a display name").max(24, "Use 24 characters or fewer");
export const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/, "Enter a six-character room code");
export const roomIdentifierSchema = z.string().trim().min(1, "Missing room identifier").max(256, "Room identifier is too long");
export const biddingSecondsSchema = z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45), z.literal(60)]);
export const proofSecondsSchema = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal("unlimited")]);
export const createRoomSchema = z.object({ name: nameSchema });
export const joinRoomSchema = z.object({ code: roomCodeSchema, name: nameSchema, token: z.string().optional() });
export const roomCommandSchema = z.object({ code: roomIdentifierSchema });
export const discordTokenExchangeSchema = z.object({
  code: z.string().trim().min(1, "Missing Discord authorization code"),
  instanceId: z.string().trim().min(1, "Missing Discord instance id")
});
export const lobbySettingsSchema = roomCommandSchema.extend({
  biddingSeconds: biddingSecondsSchema,
  proofSeconds: proofSecondsSchema,
  roundCount: z.number().int().min(1).max(999)
});
export const placeRobotSchema = roomCommandSchema.extend({
  robot: z.enum(["red", "blue", "green", "yellow", "silver"]),
  position: z.object({ row: z.number().int().min(0).max(15), col: z.number().int().min(0).max(15) })
});
export const bidSchema = roomCommandSchema.extend({ count: z.number().int().min(1).max(999) });
export const moveSchema = roomCommandSchema.extend({ robot: z.enum(["red", "blue", "green", "yellow", "silver"]), direction: z.enum(["north", "east", "south", "west"]) });
export const reviewSelectSchema = roomCommandSchema.extend({ robot: z.enum(["red", "blue", "green", "yellow", "silver"]).nullable() });
