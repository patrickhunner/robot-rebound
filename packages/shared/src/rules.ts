import { directions, robotIds, type BoardDefinition, type Direction, type Position, type RobotId, type RobotPositions, type Target } from "./types.js";
import type { AnimationSpeed } from "./types.js";

export function animationDurationMs(speed: AnimationSpeed): number {
  return 1100 - speed * 100;
}

export function movementDurationMs(speed: AnimationSpeed, distance: number, boardSize = 16): number {
  if (distance <= 0) return 0;
  return Math.round(animationDurationMs(speed) * distance / Math.max(1, boardSize - 1));
}

const delta: Record<Direction, Position> = {
  north: { row: -1, col: 0 }, east: { row: 0, col: 1 }, south: { row: 1, col: 0 }, west: { row: 0, col: -1 }
};
const opposite: Record<Direction, Direction> = { north: "south", east: "west", south: "north", west: "east" };
export const positionKey = ({ row, col }: Position) => `${row},${col}`;
export const samePosition = (a: Position, b: Position) => a.row === b.row && a.col === b.col;

function hasWall(board: BoardDefinition, position: Position, direction: Direction): boolean {
  if (direction === "north" && position.row === 0) return true;
  if (direction === "south" && position.row === board.size - 1) return true;
  if (direction === "west" && position.col === 0) return true;
  if (direction === "east" && position.col === board.size - 1) return true;
  const d = delta[direction];
  const next = { row: position.row + d.row, col: position.col + d.col };
  return board.walls.some((wall) => samePosition(wall, position) && wall.side === direction)
    || board.walls.some((wall) => samePosition(wall, next) && wall.side === opposite[direction]);
}

export function isTraversable(board: BoardDefinition, position: Position): boolean {
  return position.row >= 0 && position.col >= 0 && position.row < board.size && position.col < board.size
    && !board.blocked.some((cell) => samePosition(cell, position));
}

export function moveRobot(board: BoardDefinition, robots: RobotPositions, robot: RobotId, direction: Direction): Position | null {
  let current = robots[robot];
  const occupied = new Set(Object.entries(robots).filter(([id]) => id !== robot).map(([, position]) => positionKey(position)));
  const d = delta[direction];
  while (!hasWall(board, current, direction)) {
    const next = { row: current.row + d.row, col: current.col + d.col };
    if (!isTraversable(board, next) || occupied.has(positionKey(next))) break;
    current = next;
  }
  return samePosition(current, robots[robot]) ? null : current;
}

export interface LegalMove { direction: Direction; destination: Position }

export function legalMoves(board: BoardDefinition, robots: RobotPositions, robot: RobotId): LegalMove[] {
  return directions.flatMap((direction) => {
    const destination = moveRobot(board, robots, robot, direction);
    return destination ? [{ direction, destination }] : [];
  });
}

export function randomRobotPositions(board: BoardDefinition, random: () => number = Math.random): RobotPositions {
  const cells: Position[] = [];
  for (let row = 0; row < board.size; row++) {
    for (let col = 0; col < board.size; col++) {
      const position = { row, col };
      if (isTraversable(board, position) && !board.targets.some((target) => samePosition(target.position, position))) cells.push(position);
    }
  }
  for (let index = cells.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [cells[index], cells[swap]] = [cells[swap]!, cells[index]!];
  }
  if (cells.length < robotIds.length) throw new Error("Board does not contain enough legal robot cells");
  return Object.fromEntries(robotIds.map((robot, index) => [robot, cells[index]!])) as RobotPositions;
}

export function validatePlacement(board: BoardDefinition, robots: Partial<RobotPositions>): string | null {
  const entries = Object.entries(robots);
  if (entries.length !== 5) return "Place all five robots";
  const seen = new Set<string>();
  for (const [, position] of entries) {
    if (!isTraversable(board, position)) return "Robots must be on open board cells";
    if (board.targets.some((target) => samePosition(target.position, position))) return "Robots cannot start on a destination";
    const key = positionKey(position);
    if (seen.has(key)) return "Robots must occupy different cells";
    seen.add(key);
  }
  return null;
}

export function targetSatisfied(target: Target, robots: RobotPositions): boolean {
  if (target.robot === "wild") return Object.values(robots).some((position) => samePosition(position, target.position));
  return samePosition(robots[target.robot], target.position);
}
