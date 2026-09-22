import type { ExecCard, ExecCardStatus } from "./use-exec-cards";

export const advanceRunningCards = (cards: ExecCard[], delta: number): ExecCard[] | null => {
  let changed = false;
  const next = cards.map((card) => {
    if (card.status !== "running" || card.emergencyStopped) return card;
    if (card.durationMs === null) {
      const elapsedMs = card.elapsedMs + delta;
      changed = true;
      return { ...card, elapsedMs };
    }

    const advance = delta * (card.speedPercent / 100);
    const elapsedMs = Math.min(card.durationMs, card.elapsedMs + advance);
    const status: ExecCardStatus = elapsedMs >= card.durationMs ? "completed" : "running";
    if (elapsedMs === card.elapsedMs && status === card.status) return card;
    changed = true;
    return { ...card, elapsedMs, status };
  });
  return changed ? next : null;
};
