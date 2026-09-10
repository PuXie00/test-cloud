import { useExecCards } from "../../../hooks/use-exec-cards";
import { ExecCardView } from "./exec-card";
import { ExecEmptyState } from "./exec-empty-state";

export const ExecCards = () => {
  const { cards, pause, resume, stop, skipNext, setSpeed, close } = useExecCards();

  if (cards.length === 0) {
    return <ExecEmptyState />;
  }

  return (
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      {cards.map((card) => (
        <ExecCardView
          key={card.id}
          card={card}
          onPause={() => pause(card.id)}
          onResume={() => resume(card.id)}
          onStop={() => stop(card.id)}
          onSkipNext={() => skipNext(card.id)}
          onSetSpeed={(percent) => setSpeed(card.id, percent)}
          onClose={() => close(card.id)}
        />
      ))}
    </div>
  );
};
