import { directions, robotIds, type BoardDefinition, type RobotId, type RobotPositions, type SolutionMove, type Target } from "./types.js";
import { moveRobot, targetSatisfied } from "./rules.js";

export interface SolverResult {
  moveCount: number | null;
  solutions: SolutionMove[][];
  capped: boolean;
}

const copyRobots = (robots: RobotPositions): RobotPositions => structuredClone(robots);
const stateKey = (robots: RobotPositions, size: number): string => robotIds.map((robot) => robots[robot].row * size + robots[robot].col).join(",");

function lowerBound(target: Target, robots: RobotPositions): number {
  if (targetSatisfied(target, robots)) return 0;
  const candidates: RobotId[] = target.robot === "wild" ? [...robotIds] : [target.robot];
  return candidates.some((robot) => robots[robot].row === target.position.row || robots[robot].col === target.position.col) ? 1 : 2;
}

/** Finds up to maxSolutions distinct shortest move sequences, never searching above maxDepth. */
export function findShortestSolutions(
  board: BoardDefinition,
  startRobots: RobotPositions,
  target: Target,
  maxDepth: number,
  maxSolutions = 5
): SolverResult {
  if (maxDepth < 0 || maxSolutions < 1) return { moveCount: null, solutions: [], capped: false };
  const initialDepth = lowerBound(target, startRobots);
  for (let depth = initialDepth; depth <= maxDepth; depth++) {
    const solutions: SolutionMove[][] = [];
    const signatures = new Set<string>();
    const pathStates = new Set([stateKey(startRobots, board.size)]);
    const dead = new Map<string, number>();

    const search = (robots: RobotPositions, remaining: number, path: SolutionMove[]): boolean => {
      if (targetSatisfied(target, robots)) {
        if (remaining !== 0) return false;
        const signature = path.map((move) => `${move.robot}:${move.direction}`).join("|");
        if (!signatures.has(signature)) {
          signatures.add(signature);
          solutions.push([...path]);
        }
        return solutions.length >= maxSolutions;
      }
      if (remaining === 0 || lowerBound(target, robots) > remaining) return false;
      const key = stateKey(robots, board.size);
      if ((dead.get(key) ?? -1) >= remaining) return false;
      let foundFromState = false;
      for (const robot of robotIds) {
        for (const direction of directions) {
          const destination = moveRobot(board, robots, robot, direction);
          if (!destination) continue;
          const next = { ...copyRobots(robots), [robot]: destination };
          const nextKey = stateKey(next, board.size);
          if (pathStates.has(nextKey)) continue;
          pathStates.add(nextKey);
          path.push({ robot, direction });
          const before = solutions.length;
          const capped = search(next, remaining - 1, path);
          foundFromState ||= solutions.length > before;
          path.pop();
          pathStates.delete(nextKey);
          if (capped) return true;
        }
      }
      if (!foundFromState) dead.set(key, Math.max(dead.get(key) ?? -1, remaining));
      return false;
    };

    const capped = search(copyRobots(startRobots), depth, []);
    if (solutions.length) return { moveCount: depth, solutions, capped };
  }
  return { moveCount: null, solutions: [], capped: false };
}
