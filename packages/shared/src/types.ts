export const robotIds = ["red", "blue", "green", "yellow", "silver"] as const;
export type RobotId = (typeof robotIds)[number];
export type ColoredRobot = Exclude<RobotId, "silver">;
export const directions = ["north", "east", "south", "west"] as const;
export type Direction = (typeof directions)[number];
export const biddingSecondsOptions = [0, 15, 30, 45, 60] as const;
export type BiddingSeconds = (typeof biddingSecondsOptions)[number];
export const proofSecondsOptions = [15, 30, 45, 60, "unlimited"] as const;
export type ProofSeconds = (typeof proofSecondsOptions)[number];
export const animationSpeedOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type AnimationSpeed = (typeof animationSpeedOptions)[number];

export interface Position { row: number; col: number }
export type RobotPositions = Record<RobotId, Position>;

export interface Target {
  id: string;
  position: Position;
  robot: ColoredRobot | "wild";
  symbol: "circle" | "triangle" | "square" | "star" | "vortex";
}

export interface Wall { row: number; col: number; side: Direction }
export interface BoardDefinition {
  id: string;
  size: number;
  blocked: Position[];
  walls: Wall[];
  targets: Target[];
}

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  eligible: boolean;
  wonTargets: Target[];
}

export interface BidView { playerId: string; count: number; receivedAt: number }
export interface SolutionMove { robot: RobotId; direction: Direction }
export type RobotLocks = Partial<Record<RobotId, string>>;
export interface BaseRoomView {
  code: string;
  selfId: string;
  hostId: string;
  players: PlayerView[];
  biddingSeconds: BiddingSeconds;
  proofSeconds: ProofSeconds;
  roundCount: number;
  animationSpeed: AnimationSpeed;
  board: BoardDefinition;
}
export type RoomSnapshot = BaseRoomView & (
  | { phase: "lobby" }
  | { phase: "placement"; round: number; placerId: string; robots: RobotPositions }
  | { phase: "solving"; round: number; robots: RobotPositions; target: Target }
  | { phase: "bidding"; round: number; robots: RobotPositions; target: Target; bids: BidView[]; deadline: number }
  | { phase: "proving"; round: number; robots: RobotPositions; target: Target; bids: BidView[]; activeBidderId: string; bidCount: number; moveCount: number; deadline: number | null }
  | { phase: "review"; round: number; startRobots: RobotPositions; robots: RobotPositions; target: Target; winnerId: string; winningMoveCount: number; moveCount: number; locks: RobotLocks; playbackActive: boolean }
  | { phase: "results"; winners: string[] }
);

export interface CommandResult { ok: boolean; error?: string; token?: string; code?: string }
