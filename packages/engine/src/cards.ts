// Card encoding: id 0..51 → rank 1..13 (A..K), suit 0..3 (♣ ♦ ♥ ♠, low→high)

export type Card = number;

export const SUITS = ["♣", "♦", "♥", "♠"] as const;
export const SUIT_NAMES = ["clubs", "diamonds", "hearts", "spades"] as const;
const RANK_STRS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export const rankOf = (id: Card): number => (id % 13) + 1;
export const suitOf = (id: Card): number => Math.floor(id / 13);
export const rankStr = (id: Card): string => RANK_STRS[rankOf(id) - 1];
export const isRed = (id: Card): boolean => suitOf(id) === 1 || suitOf(id) === 2;
export const cardName = (id: Card): string => `${rankStr(id)}${SUITS[suitOf(id)]}`;
// Scuttle comparison: rank first, then suit ♣<♦<♥<♠
export const cardPower = (id: Card): number => rankOf(id) * 4 + suitOf(id);

/** Build a card id from rank (1..13) and suit (0..3) — handy for tests. */
export const cardId = (rank: number, suit: number): Card => suit * 13 + (rank - 1);

export const ONE_OFF_DESC: Record<number, string> = {
  1: "Scrap ALL point cards on the table (both sides).",
  2: "Scrap any Royal, Glasses-8 or Jack on the table — or counter a one-off.",
  3: "Take any one card from the scrap pile into your hand.",
  4: "Opponent must discard two cards of their choice.",
  5: "Draw two cards.",
  6: "Scrap ALL Royals, Glasses-8s and Jacks on the table.",
  7: "Draw the top card — you must play it immediately.",
  9: "Place any permanent on the table on top of the draw pile (house rule).",
};
