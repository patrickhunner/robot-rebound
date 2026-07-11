import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  createRoomSchema, joinRoomSchema, legalMoves,
  type BiddingSeconds, type CommandResult, type LegalMove, type ProofSeconds, type RobotId, type RoomSnapshot, type Target
} from "@robot-rebound/shared";
import { Board } from "./Board";

const socket = io({ autoConnect: true });
type Session = { code: string; name: string; token: string };
const loadSession = (): Session | null => { try { const value = sessionStorage.getItem("robot-rebound-session"); return value ? JSON.parse(value) as Session : null; } catch { return null; } };

function send(event: string, payload: object, onResult?: (result: CommandResult) => void): void {
  socket.emit(event, payload, (result: CommandResult) => onResult?.(result));
}

export function App() {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onSnapshot = (next: RoomSnapshot) => { setSnapshot(next); setError(""); };
    const onConnect = () => {
      setConnected(true);
      if (session) send("room:join", session, (result) => { if (!result.ok) setError(result.error ?? "Could not reconnect"); });
    };
    const onDisconnect = () => setConnected(false);
    socket.on("room:snapshot", onSnapshot); socket.on("connect", onConnect); socket.on("disconnect", onDisconnect);
    if (socket.connected && session && !snapshot) onConnect();
    return () => { socket.off("room:snapshot", onSnapshot); socket.off("connect", onConnect); socket.off("disconnect", onDisconnect); };
  }, [session]);

  const completeJoin = (name: string, result: CommandResult) => {
    if (!result.ok || !result.code || !result.token) { setError(result.error ?? "Unable to join room"); return; }
    const next = { code: result.code, name, token: result.token };
    sessionStorage.setItem("robot-rebound-session", JSON.stringify(next)); setSession(next); setError("");
  };

  if (!snapshot) return <Landing connected={connected} error={error} onError={setError} onComplete={completeJoin} />;
  return <Game snapshot={snapshot} connected={connected} error={error} onError={setError} />;
}

function Landing({ connected, error, onError, onComplete }: { connected: boolean; error: string; onError: (value: string) => void; onComplete: (name: string, result: CommandResult) => void }) {
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const nameRef = useRef<HTMLInputElement>(null); const codeRef = useRef<HTMLInputElement>(null);
  const create = () => {
    const parsed = createRoomSchema.safeParse({ name });
    if (!parsed.success) { onError(parsed.error.issues[0]?.message ?? "Check the room details"); nameRef.current?.focus(); return; }
    send("room:create", parsed.data, (result) => onComplete(parsed.data.name, result));
  };
  const join = () => {
    const parsed = joinRoomSchema.safeParse({ code, name });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; onError(issue?.message ?? "Check the room details");
      (issue?.path[0] === "code" ? codeRef : nameRef).current?.focus(); return;
    }
    send("room:join", parsed.data, (result) => onComplete(parsed.data.name, result));
  };
  return <main className="landing">
    <section className="hero"><p className="eyebrow">MULTIPLAYER LOGIC RACE</p><h1>Robot<br />Rebound</h1><p>See the route. Call your count. Prove it live.</p><span className={`connection ${connected ? "online" : ""}`}>{connected ? "Server connected" : "Connecting…"}</span></section>
    <section className="entry-card">
      <label>Display name<input ref={nameRef} aria-label="Display name" value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="Ada" /></label>
      <div className="entry-section"><h2>Create a room</h2><p>Match length and timers can be changed by the host in the lobby.</p><button onClick={create}>Create room</button></div>
      <div className="or">or join one</div>
      <div className="join-row"><input ref={codeRef} aria-label="Room code" value={code} maxLength={6} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABC234" /><button className="secondary" onClick={join}>Join</button></div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  </main>;
}

function Game({ snapshot, connected, error, onError }: { snapshot: RoomSnapshot; connected: boolean; error: string; onError: (value: string) => void }) {
  const self = snapshot.players.find((player) => player.id === snapshot.selfId)!;
  const [selectedRobot, setSelectedRobot] = useState<RobotId | null>(null);
  const [bid, setBid] = useState("");
  const deadline = "deadline" in snapshot && snapshot.deadline !== null ? snapshot.deadline : undefined;
  const unlimitedProof = snapshot.phase === "proving" && snapshot.deadline === null;
  const seconds = useCountdown(deadline);
  const command = (event: string, payload: object = {}, onSuccess?: () => void) => send(event, { code: snapshot.code, ...payload }, (result) => { if (!result.ok) onError(result.error ?? "Action rejected"); else onSuccess?.(); });
  const title = phaseTitle(snapshot);
  const robots = "robots" in snapshot ? snapshot.robots : {};
  const canPlace = snapshot.phase === "placement" && snapshot.placerId === self.id;
  const canProve = snapshot.phase === "proving" && snapshot.activeBidderId === self.id;
  const alreadyBid = (snapshot.phase === "bidding" || snapshot.phase === "proving") && snapshot.bids.some((item) => item.playerId === self.id);
  const proofMoves = useMemo<LegalMove[]>(() => canProve && selectedRobot ? legalMoves(snapshot.board, robots as Extract<RoomSnapshot, { phase: "proving" }>["robots"], selectedRobot) : [], [canProve, robots, selectedRobot, snapshot.board]);
  useEffect(() => setSelectedRobot(null), [snapshot.phase, "round" in snapshot ? snapshot.round : 0, snapshot.phase === "proving" ? snapshot.activeBidderId : ""]);
  useEffect(() => setBid(""), ["round" in snapshot ? snapshot.round : 0]);
  const moveByCell = (row: number, col: number) => {
    if (!selectedRobot) return;
    if (canPlace) command("placement:place", { robot: selectedRobot, position: { row, col } });
    if (canProve) {
      const move = proofMoves.find((item) => item.destination.row === row && item.destination.col === col);
      if (move) command("proof:move", { robot: selectedRobot, direction: move.direction });
    }
  };
  const endMatch = () => {
    if (window.confirm("End this match now and use the current scores?")) command("match:end");
  };

  return <main className={`game-shell ${(canPlace || canProve) ? "active-turn" : ""}`}>
    <header><div><span className="mini-mark">RR</span><strong>Robot Rebound</strong></div><div className="room-code">Room <b>{snapshot.code}</b><button className="copy" onClick={() => navigator.clipboard.writeText(snapshot.code)}>Copy</button></div><span className={`connection ${connected ? "online" : ""}`}>{connected ? "Live" : "Reconnecting"}</span></header>
    <section className="status-bar"><div><p className="eyebrow">{snapshot.phase === "lobby" || snapshot.phase === "results" ? "MATCH" : `ROUND ${snapshot.round} / ${snapshot.roundCount}`}</p><h1>{title}</h1></div>{deadline && <div className="timer" aria-label={`${seconds} seconds remaining`}><b>{seconds}</b><span>seconds</span></div>}{unlimitedProof && <div className="timer unlimited" aria-label="Unlimited proof time"><b>∞</b><span>unlimited</span></div>}</section>
    <div className="game-grid">
      <Leaderboard snapshot={snapshot} />
      <section className="board-panel">
        {"target" in snapshot && <div className={`target-banner target-${snapshot.target.robot}`}><span>{snapshot.target.symbol}</span><b>{snapshot.target.robot === "wild" ? "Any robot" : `${snapshot.target.robot} robot`}</b> to the highlighted destination</div>}
        <Board board={snapshot.board} robots={robots} target={"target" in snapshot ? snapshot.target : undefined} interaction={canPlace ? "placement" : canProve ? "proof" : "none"} selectedRobot={selectedRobot} legalDestinations={proofMoves.map((move) => move.destination)} onRobot={setSelectedRobot} onCell={(position) => moveByCell(position.row, position.col)} />
        {canPlace && <div className="placement-controls"><button className="secondary" onClick={() => command("placement:randomize")}>Randomize robots</button><button className="waiting-action" onClick={() => command("placement:confirm")}>Reveal destination</button></div>}
      </section>
      <aside className="control-sidebar">
        {snapshot.phase === "proving" && <ProofPanel snapshot={snapshot} selfId={self.id} selectedRobot={selectedRobot} onReset={() => command("proof:reset")} />}
        <ActionPanel snapshot={snapshot} selfId={self.id} bid={bid} setBid={setBid} alreadyBid={alreadyBid} command={command} />
        {self.isHost && snapshot.phase !== "lobby" && snapshot.phase !== "results" && <button className="danger-button" onClick={endMatch}>End match early</button>}
        {error && <p role="alert" className="error">{error}</p>}
      </aside>
    </div>
  </main>;
}

function ActionPanel({ snapshot, selfId, bid, setBid, alreadyBid, command }: { snapshot: RoomSnapshot; selfId: string; bid: string; setBid: (value: string) => void; alreadyBid: boolean; command: (event: string, payload?: object) => void }) {
  const bidInputRef = useRef<HTMLInputElement>(null);
  const eligible = snapshot.players.find((player) => player.id === selfId)?.eligible ?? false;
  const canBid = (snapshot.phase === "solving" || snapshot.phase === "bidding") && eligible && !alreadyBid;
  useEffect(() => { if (canBid) bidInputRef.current?.focus(); }, [canBid, snapshot.phase]);
  const parsedBid = /^\d+$/.test(bid) ? Number(bid) : 0;
  const submitBid = (count: number) => { if (count >= 1 && count <= 999) command("bid:submit", { count }); };
  if (snapshot.phase === "lobby") return <LobbyPanel snapshot={snapshot} selfId={selfId} command={command} />;
  if (snapshot.phase === "placement") { const placer = snapshot.players.find((player) => player.id === snapshot.placerId); return <section className="action-card"><h2>Placement</h2><p>{placer?.id === selfId ? "Click a robot, then an open cell. Keep every robot off the destination symbols." : `${placer?.name} is placing the robots.`}</p></section>; }
  if (snapshot.phase === "solving" || snapshot.phase === "bidding") return <section className="action-card"><h2>{snapshot.phase === "solving" ? "Found a route?" : "Bidding is open"}</h2><p>Each player gets one bid. Type a count and press Enter, or lock a quick bid.</p><form className="bid-entry" onSubmit={(event) => { event.preventDefault(); submitBid(parsedBid); }}><input ref={bidInputRef} aria-label="Move count" inputMode="numeric" autoComplete="off" placeholder="Move count" value={bid} disabled={!canBid} onChange={(event) => setBid(event.target.value.replace(/\D/g, ""))} /></form><div className="quick-bids" aria-label="Quick bids">{Array.from({ length: 30 }, (_, index) => index + 1).map((count) => <button key={count} disabled={!canBid} onClick={() => submitBid(count)}>{count}</button>)}</div>{alreadyBid && <p className="bid-locked">Your bid is locked.</p>}{snapshot.phase === "bidding" && <BidList snapshot={snapshot} />}</section>;
  if (snapshot.phase === "proving") return <section className="action-card"><h2>Proof in progress</h2><p>{snapshot.activeBidderId === selfId ? "Click a robot, then one of its highlighted landing cells." : `${snapshot.players.find((player) => player.id === snapshot.activeBidderId)?.name} is proving.`}</p><BidList snapshot={snapshot} /></section>;
  return <section className="action-card"><h2>Match complete</h2><p>Winners: {snapshot.winners.map((id) => snapshot.players.find((player) => player.id === id)?.name).join(", ")}</p>{snapshot.hostId === selfId && <button onClick={() => command("match:lobby")}>Return to lobby</button>}</section>;
}

function LobbyPanel({ snapshot, selfId, command }: { snapshot: Extract<RoomSnapshot, { phase: "lobby" }>; selfId: string; command: (event: string, payload?: object) => void }) {
  const [biddingSeconds, setBiddingSeconds] = useState<BiddingSeconds>(snapshot.biddingSeconds);
  const [proofSeconds, setProofSeconds] = useState<ProofSeconds>(snapshot.proofSeconds);
  const [roundCount, setRoundCount] = useState(String(snapshot.roundCount));
  useEffect(() => { setBiddingSeconds(snapshot.biddingSeconds); setProofSeconds(snapshot.proofSeconds); setRoundCount(String(snapshot.roundCount)); }, [snapshot.biddingSeconds, snapshot.proofSeconds, snapshot.roundCount]);
  const isHost = snapshot.hostId === selfId;
  if (!isHost) return <section className="action-card"><h2>Lobby</h2><p>Waiting for the host. {snapshot.roundCount} rounds; bidding {snapshot.biddingSeconds === 0 ? "immediately" : `${snapshot.biddingSeconds}s`}; proof {snapshot.proofSeconds === "unlimited" ? "unlimited" : `${snapshot.proofSeconds}s`}.</p></section>;
  const rounds = Number(roundCount);
  const validRounds = Number.isInteger(rounds) && rounds >= 1 && rounds <= 999;
  return <section className="action-card"><h2>Match settings</h2><div className="settings-grid"><label>Rounds<input aria-label="Rounds" type="number" min={1} max={999} value={roundCount} onChange={(event) => setRoundCount(event.target.value)} /></label><label>Bidding window<select aria-label="Bidding window" value={biddingSeconds} onChange={(event) => setBiddingSeconds(Number(event.target.value) as BiddingSeconds)}><option value={0}>Immediate</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={45}>45 seconds</option><option value={60}>60 seconds</option></select></label><label>Proof time<select aria-label="Proof time" value={proofSeconds} onChange={(event) => setProofSeconds(event.target.value === "unlimited" ? "unlimited" : Number(event.target.value) as ProofSeconds)}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={45}>45 seconds</option><option value={60}>60 seconds</option><option value="unlimited">Unlimited</option></select></label></div><div className="lobby-actions"><button className="secondary" disabled={!validRounds} onClick={() => command("lobby:settings", { biddingSeconds, proofSeconds, roundCount: rounds })}>Save settings</button><button className="secondary" onClick={() => command("board:shuffle")}>Shuffle Board</button><button onClick={() => command("match:start")}>Start match</button></div></section>;
}

function Leaderboard({ snapshot }: { snapshot: RoomSnapshot }) {
  const players = [...snapshot.players].sort((a, b) => b.wonTargets.length - a.wonTargets.length || a.name.localeCompare(b.name));
  return <aside className="leaderboard"><h2>Leaderboard</h2>{players.map((player, index) => <div className={`leader ${player.id === snapshot.selfId ? "self" : ""}`} key={player.id}><div className="leader-name"><span className="rank">{index + 1}</span><span className={`presence ${player.connected ? "present" : ""}`} /><b>{player.name}{player.id === snapshot.selfId ? " (you)" : ""}</b><strong>{player.wonTargets.length}</strong></div><div className="won-tiles">{player.wonTargets.map((target, tileIndex) => <TargetTile key={`${target.id}-${tileIndex}`} target={target} />)}</div></div>)}</aside>;
}

function TargetTile({ target }: { target: Target }) {
  const symbol = ({ circle: "●", triangle: "▲", square: "■", star: "★", vortex: "✦" } as const)[target.symbol];
  return <span className={`won-tile destination-${target.robot}`} title={`${target.robot} ${target.symbol}`}>{symbol}</span>;
}

function ProofPanel({ snapshot, selfId, selectedRobot, onReset }: { snapshot: Extract<RoomSnapshot, { phase: "proving" }>; selfId: string; selectedRobot: RobotId | null; onReset: () => void }) {
  const active = snapshot.activeBidderId === selfId;
  return <section className={`proof-status ${active ? "active" : ""}`}><span>Moves used</span><strong>{snapshot.moveCount}<small> / {snapshot.bidCount}</small></strong>{active && <><p>{selectedRobot ? `${selectedRobot} selected` : "Select a robot"}</p><button className="proof-reset" onClick={onReset}>Reset proof</button></>}</section>;
}

function BidList({ snapshot }: { snapshot: Extract<RoomSnapshot, { phase: "bidding" | "proving" }> }) {
  return <ol className="bid-list">{[...snapshot.bids].sort((a, b) => a.count - b.count || a.receivedAt - b.receivedAt).map((bid) => <li key={bid.playerId}><span>{snapshot.players.find((player) => player.id === bid.playerId)?.name}</span><b>{bid.count}</b></li>)}</ol>;
}

function useCountdown(deadline?: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!deadline) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [deadline]);
  return useMemo(() => deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0, [deadline, now]);
}

function phaseTitle(snapshot: RoomSnapshot): string {
  if (snapshot.phase === "lobby") return "Gather your crew";
  if (snapshot.phase === "placement") return snapshot.placerId === snapshot.selfId ? "Place the robots" : "Board setup in progress";
  if (snapshot.phase === "solving") return "Find the shortest route";
  if (snapshot.phase === "bidding") return "Lock in your claim";
  if (snapshot.phase === "proving") return snapshot.activeBidderId === snapshot.selfId ? "Show your solution" : "Watch the proof";
  return "Final scores";
}
