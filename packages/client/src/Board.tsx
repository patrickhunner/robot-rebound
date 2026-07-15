import { useLayoutEffect, useRef } from "react";
import { movementDurationMs, type AnimationSpeed, type BoardDefinition, type Position, type RobotId, type Target } from "@robot-rebound/shared";

type Interaction = "none" | "placement" | "proof" | "review";

export function Board({ board, robots, target, interaction, selectedRobot, legalDestinations, lockedRobots = {}, animationSpeed, onRobot, onCell, onEmpty }: {
  board: BoardDefinition;
  robots: Partial<Record<RobotId, Position>>;
  target: Target | undefined;
  interaction: Interaction;
  selectedRobot: RobotId | null;
  legalDestinations: Position[];
  lockedRobots?: Partial<Record<RobotId, string>>;
  animationSpeed: AnimationSpeed;
  onRobot: (robot: RobotId) => void;
  onCell: (position: Position) => void;
  onEmpty?: () => void;
}) {
  const previousRobots = useRef<Partial<Record<RobotId, Position>>>({});
  const transitionDurations = useRef<Partial<Record<RobotId, number>>>({});
  useLayoutEffect(() => { previousRobots.current = structuredClone(robots); }, [robots]);
  const cells = Array.from({ length: board.size * board.size }, (_, index) => ({ row: Math.floor(index / board.size), col: index % board.size }));
  return <div className="board" style={{ gridTemplateColumns: `repeat(${board.size}, 1fr)` }} role="grid" aria-label="Robot board">
    {cells.map((position) => {
      const blocked = board.blocked.some((cell) => cell.row === position.row && cell.col === position.col);
      const destination = board.targets.find((item) => item.position.row === position.row && item.position.col === position.col);
      const robot = Object.entries(robots).find(([, cell]) => cell.row === position.row && cell.col === position.col)?.[0] as RobotId | undefined;
      const activeTarget = target?.id === destination?.id;
      const legalDestination = legalDestinations.some((cell) => cell.row === position.row && cell.col === position.col);
      const placementDestination = interaction === "placement" && selectedRobot !== null && !robot && !destination && !blocked;
      const robotLocked = robot ? lockedRobots[robot] : undefined;
      const selectableRobot = robot !== undefined && interaction !== "none" && !robotLocked;
      const reviewEmpty = interaction === "review" && !robot && !legalDestination;
      const clickable = selectableRobot || placementDestination || legalDestination || reviewEmpty;
      const walls = board.walls.filter((wall) => wall.row === position.row && wall.col === position.col).map((wall) => `wall-${wall.side}`).join(" ");
      const activate = () => {
        if (robot && selectableRobot) onRobot(robot);
        else if (placementDestination || legalDestination) onCell(position);
        else if (reviewEmpty) onEmpty?.();
      };
      return <button type="button" role="gridcell" aria-label={`row ${position.row + 1}, column ${position.col + 1}${robot ? `, ${robot} robot` : ""}${robotLocked ? `, locked by ${robotLocked}` : ""}${legalDestination ? ", legal destination" : ""}`} aria-disabled={!clickable} onClick={activate} key={`${position.row}-${position.col}`} className={`cell ${blocked ? "blocked" : ""} ${walls} ${activeTarget ? "active-target" : ""} ${legalDestination ? "legal-destination" : ""} ${robotLocked ? "robot-locked" : ""} ${clickable ? "clickable" : ""}`}>
        {destination && <span className={`destination destination-${destination.robot}`} title={`${destination.robot} ${destination.symbol}`}>{symbol(destination.symbol)}</span>}
        {placementDestination && <span className={`placement-hint robot-${selectedRobot}`} />}
      </button>;
    })}
    {Object.entries(robots).map(([id, position]) => {
      const robot = id as RobotId;
      const lockedBy = lockedRobots[robot];
      const selectable = interaction !== "none" && !lockedBy;
      const previous = previousRobots.current[robot];
      const distance = previous ? Math.abs(previous.row - position.row) + Math.abs(previous.col - position.col) : 0;
      if (distance > 0) transitionDurations.current[robot] = movementDurationMs(animationSpeed, distance, board.size);
      const transitionDuration = transitionDurations.current[robot] ?? 0;
      return <button type="button" aria-label={`${robot} robot${lockedBy ? `, locked by ${lockedBy}` : ""}`} disabled={!selectable} onClick={() => onRobot(robot)} className={`board-robot ${lockedBy ? "robot-locked" : ""} ${selectable ? "clickable" : ""}`} style={{ left: `${position.col / board.size * 100}%`, top: `${position.row / board.size * 100}%`, width: `${100 / board.size}%`, height: `${100 / board.size}%`, transitionDuration: `${transitionDuration}ms` }} key={robot}>
        <span className={`robot robot-${robot} ${robot === selectedRobot ? "selected-robot" : ""}`} title={lockedBy ? `${robot} robot — locked by ${lockedBy}` : `${robot} robot`}>{robot.slice(0, 1).toUpperCase()}</span>
      </button>;
    })}
  </div>;
}

const symbol = (value: Target["symbol"]) => ({ circle: "●", triangle: "▲", square: "■", star: "★", vortex: "✦" })[value];
