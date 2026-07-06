import type { Card } from "./cards";

export type PlayerId = "p1" | "p2";

export type Phase =
  | "waiting" // room created, p2 has not joined
  | "play" // turn player draws or plays a card
  | "counter" // a one-off is pending; actor may counter with a 2
  | "discard" // a Four resolved; actor must discard
  | "scrap_pick" // a Three resolved; actor picks from the scrap
  | "seven" // a Seven resolved; actor must play the revealed card
  | "over";

/** A point card on the table, with any jacks played on it. `base` is the
 *  original owner — a Six sends stolen cards back to it. */
export interface PointStack {
  c: Card;
  jacks: Card[];
  base: PlayerId;
}

/** A royal on the table. `g` marks an Eight played sideways as Glasses. */
export interface Royal {
  c: Card;
  g: boolean;
}

export type TargetKind = "royal" | "jack" | "point";

export interface Target {
  kind: TargetKind;
  p: PlayerId;
  i: number;
}

export interface Counter {
  c: Card;
  by: PlayerId;
}

/** A one-off in suspension, waiting for the counter chain to settle. */
export interface PendingOneOff {
  c: Card;
  by: PlayerId;
  target: Target | null;
  counters: Counter[];
  fromSeven: boolean;
}

export interface GameState {
  phase: Phase;
  turn: PlayerId;
  actor: PlayerId | null;
  pending: PendingOneOff | null;
  sevenCard: Card | null;
  discardNeed: number;
  deck: Card[];
  scrap: Card[];
  hands: Record<PlayerId, Card[]>;
  points: Record<PlayerId, PointStack[]>;
  royals: Record<PlayerId, Royal[]>;
  names: Record<PlayerId, string>;
  dealer: PlayerId;
  passes: number;
  winner: PlayerId | "draw" | null;
  log: string[];
  /** The Three one-off card itself while its owner rummages the scrap
   *  (legacy `_pendingCard`); scrapped once the pick completes. */
  pendingCard?: Card;
  /** Whether the pending Three/Four came from a Seven (legacy `_fromSeven`). */
  pendingFromSeven?: boolean;
}

export type Rng = () => number;

export const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
