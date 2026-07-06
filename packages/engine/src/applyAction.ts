import type { Card } from "./cards";
import {
  actDiscardDone,
  actDraw,
  actJack,
  actJoinAsP2,
  actOneOff,
  actPoint,
  actRematch,
  actRoyal,
  actScrapPick,
  actScuttle,
  actSevenDiscard,
  declineCounter,
  playCounterTwo,
} from "./actions";
import type { GameState, PlayerId, Rng, Target } from "./types";

/** Serializable description of a move. This is the single entry point a
 *  future Cloud Function can use to re-validate client moves. */
export type Action =
  | { type: "draw"; by: PlayerId }
  | { type: "point"; by: PlayerId; card: Card; fromSeven?: boolean }
  | { type: "scuttle"; by: PlayerId; card: Card; targetIdx: number; fromSeven?: boolean }
  | { type: "royal"; by: PlayerId; card: Card; glasses?: boolean; fromSeven?: boolean }
  | { type: "jack"; by: PlayerId; card: Card; targetIdx: number; fromSeven?: boolean }
  | { type: "oneOff"; by: PlayerId; card: Card; target?: Target | null; fromSeven?: boolean }
  | { type: "counter"; by: PlayerId; card: Card }
  | { type: "declineCounter"; by: PlayerId }
  | { type: "scrapPick"; by: PlayerId; card: Card }
  | { type: "discard"; by: PlayerId; cards: Card[] }
  | { type: "sevenDiscard"; by: PlayerId }
  | { type: "rematch"; by: PlayerId }
  | { type: "join"; name: string };

/** Applies `action` to `s` in place. Returns false (leaving `s` untouched by
 *  guard convention) when the action is illegal in the current state. */
export function applyAction(s: GameState, action: Action, rng: Rng = Math.random): boolean {
  switch (action.type) {
    case "draw":
      return actDraw(s, action.by);
    case "point":
      return actPoint(s, action.by, action.card, action.fromSeven);
    case "scuttle":
      return actScuttle(s, action.by, action.card, action.targetIdx, action.fromSeven);
    case "royal":
      return actRoyal(s, action.by, action.card, action.glasses, action.fromSeven);
    case "jack":
      return actJack(s, action.by, action.card, action.targetIdx, action.fromSeven);
    case "oneOff":
      return actOneOff(s, action.by, action.card, action.target, action.fromSeven);
    case "counter":
      return playCounterTwo(s, action.by, action.card);
    case "declineCounter":
      return declineCounter(s, action.by);
    case "scrapPick":
      return actScrapPick(s, action.by, action.card);
    case "discard":
      return actDiscardDone(s, action.by, action.cards);
    case "sevenDiscard":
      return actSevenDiscard(s, action.by);
    case "rematch":
      return actRematch(s, action.by, rng);
    case "join":
      return actJoinAsP2(s, action.name);
  }
}
