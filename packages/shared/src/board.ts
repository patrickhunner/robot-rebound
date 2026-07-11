import type { BoardDefinition, Direction, Position, Target, Wall } from "./types.js";

export interface QuadrantDefinition {
  id: string;
  targets: Target[];
  walls: Wall[];
}

export const boardCorners = ["northwest", "northeast", "southeast", "southwest"] as const;
export type BoardCorner = (typeof boardCorners)[number];

// Quadrants use zero-based 8×8 local coordinates and are authored as if they
// occupy the northwest corner: outer edges are north/west and the center-facing
// corner is southeast. Assembly rotates both coordinates and wall directions.
export const quadrants: QuadrantDefinition[] = [
  {
    id: "aurora",
    targets: [
      { id: "green-triangle", position: { row: 2, col: 1 }, robot: "green", symbol: "triangle" },
      { id: "yellow-star", position: { row: 1, col: 6 }, robot: "yellow", symbol: "star" },
      { id: "red-circle", position: { row: 6, col: 3 }, robot: "red", symbol: "circle" },
      { id: "blue-square", position: { row: 5, col: 6 }, robot: "blue", symbol: "square" }
    ],
    walls: [
      { row: 0, col: 4, side: "east" },
      { row: 1, col: 6, side: "east" }, { row: 1, col: 6, side: "south" },
      { row: 2, col: 1, side: "north" }, { row: 2, col: 1, side: "west" },
      { row: 5, col: 0, side: "south" },
      { row: 5, col: 6, side: "north" }, { row: 5, col: 6, side: "east" },
      { row: 6, col: 3, side: "west" }, { row: 6, col: 3, side: "south" },
      { row: 7, col: 7, side: "north" }, { row: 7, col: 7, side: "west" }
    ]
  },
  {
    id: "comet",
    targets: [
      { id: "yellow-circle", position: { row: 1, col: 2 }, robot: "yellow", symbol: "circle" },
      { id: "blue-triangle", position: { row: 3, col: 6 }, robot: "blue", symbol: "triangle" },
      { id: "red-square", position: { row: 5, col: 4 }, robot: "red", symbol: "square" },
      { id: "green-star", position: { row: 6, col: 1 }, robot: "green", symbol: "star" }
    ],
    walls: [
      { row: 0, col: 4, side: "east" },
      { row: 1, col: 2, side: "north" }, { row: 1, col: 2, side: "west" },
      { row: 3, col: 6, side: "south" }, { row: 3, col: 6, side: "west" },
      { row: 4, col: 0, side: "south" },
      { row: 5, col: 4, side: "north" }, { row: 5, col: 4, side: "east" },
      { row: 6, col: 1, side: "south" }, { row: 6, col: 1, side: "east" },
      { row: 7, col: 7, side: "north" }, { row: 7, col: 7, side: "west" }
    ]
  },
  {
    id: "nova",
    targets: [
      { id: "red-triangle", position: { row: 1, col: 1 }, robot: "red", symbol: "triangle" },
      { id: "green-circle", position: { row: 2, col: 6 }, robot: "green", symbol: "circle" },
      { id: "blue-star", position: { row: 4, col: 2 }, robot: "blue", symbol: "star" },
      { id: "yellow-square", position: { row: 5, col: 7 }, robot: "yellow", symbol: "square" }
    ],
    walls: [
      { row: 0, col: 3, side: "east" },
      { row: 1, col: 1, side: "south" }, { row: 1, col: 1, side: "west" },
      { row: 2, col: 6, side: "north" }, { row: 2, col: 6, side: "east" },
      { row: 4, col: 2, side: "south" }, { row: 4, col: 2, side: "east" },
      { row: 5, col: 7, side: "north" }, { row: 5, col: 7, side: "west" },
      { row: 6, col: 0, side: "north" },
      { row: 7, col: 7, side: "north" }, { row: 7, col: 7, side: "west" }
    ]
  },
  {
    id: "pulsar",
    targets: [
      { id: "red-star", position: { row: 1, col: 2 }, robot: "red", symbol: "star" },
      { id: "green-square", position: { row: 3, col: 1 }, robot: "green", symbol: "square" },
      { id: "yellow-triangle", position: { row: 4, col: 6 }, robot: "yellow", symbol: "triangle" },
      { id: "blue-circle", position: { row: 6, col: 5 }, robot: "blue", symbol: "circle" },
      { id: "wild-vortex", position: { row: 7, col: 3 }, robot: "wild", symbol: "vortex" }
    ],
    walls: [
      { row: 0, col: 4, side: "east" },
      { row: 1, col: 2, side: "east" }, { row: 1, col: 2, side: "south" },
      { row: 3, col: 1, side: "south" }, { row: 3, col: 1, side: "west" },
      { row: 4, col: 6, side: "north" }, { row: 4, col: 6, side: "west" },
      { row: 5, col: 0, side: "north" },
      { row: 6, col: 5, side: "north" }, { row: 6, col: 5, side: "east" },
      { row: 7, col: 3, side: "east" }, { row: 7, col: 3, side: "south" }, 
      { row: 7, col: 7, side: "north" }, { row: 7, col: 7, side: "west" }

    ]
  }
];

const rotations: Record<BoardCorner, 0 | 1 | 2 | 3> = { northwest: 0, northeast: 1, southeast: 2, southwest: 3 };
const offsets: Record<BoardCorner, Position> = {
  northwest: { row: 0, col: 0 }, northeast: { row: 0, col: 8 },
  southeast: { row: 8, col: 8 }, southwest: { row: 8, col: 0 }
};
const clockwiseDirection: Record<Direction, Direction> = { north: "east", east: "south", south: "west", west: "north" };

function rotatePosition(position: Position, turns: number): Position {
  let result = { ...position };
  for (let turn = 0; turn < turns; turn++) result = { row: result.col, col: 7 - result.row };
  return result;
}

function rotateDirection(direction: Direction, turns: number): Direction {
  let result = direction;
  for (let turn = 0; turn < turns; turn++) result = clockwiseDirection[result];
  return result;
}

export function assembleBoard(orderedQuadrants: readonly QuadrantDefinition[]): BoardDefinition {
  if (orderedQuadrants.length !== 4) throw new Error("A board requires exactly four quadrants");
  const targets: Target[] = [];
  const walls: Wall[] = [];
  boardCorners.forEach((corner, index) => {
    const quadrant = orderedQuadrants[index]!;
    const turns = rotations[corner];
    const offset = offsets[corner];
    quadrant.targets.forEach((target) => {
      const local = rotatePosition(target.position, turns);
      targets.push({ ...target, position: { row: local.row + offset.row, col: local.col + offset.col } });
    });
    quadrant.walls.forEach((wall) => {
      const local = rotatePosition(wall, turns);
      walls.push({ row: local.row + offset.row, col: local.col + offset.col, side: rotateDirection(wall.side, turns) });
    });
  });
  return {
    id: `quadrants-${orderedQuadrants.map((quadrant) => quadrant.id).join("-")}`,
    size: 16,
    blocked: [{ row: 7, col: 7 }, { row: 7, col: 8 }, { row: 8, col: 7 }, { row: 8, col: 8 }],
    walls,
    targets
  };
}

export function createRandomBoard(random: () => number = Math.random, excludedBoardId?: string): BoardDefinition {
  const shuffled = [...quadrants];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  if (`quadrants-${shuffled.map((quadrant) => quadrant.id).join("-")}` === excludedBoardId) {
    shuffled.push(shuffled.shift()!);
  }
  return assembleBoard(shuffled);
}

export const classicBoard = assembleBoard(quadrants);
