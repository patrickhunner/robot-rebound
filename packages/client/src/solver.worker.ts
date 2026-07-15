/// <reference lib="webworker" />
import { findShortestSolutions, type BoardDefinition, type RobotPositions, type Target } from "@robot-rebound/shared";

interface SolverRequest { board: BoardDefinition; robots: RobotPositions; target: Target; maxDepth: number }

self.onmessage = (event: MessageEvent<SolverRequest>) => {
  const { board, robots, target, maxDepth } = event.data;
  self.postMessage(findShortestSolutions(board, robots, target, maxDepth, 5));
};
