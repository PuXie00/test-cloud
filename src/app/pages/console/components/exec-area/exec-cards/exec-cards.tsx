import { useExecCards } from "../../../hooks/use-exec-cards";
import { useProgram } from "../../../hooks/use-program";
import { nextSequenceIsFree } from "../../../hooks/sequence-run-status";
import { ExecCardView } from "./exec-card";
import { ExecEmptyState } from "./exec-empty-state";

type ExecCardsProps = {
  onNextSequence?: (cardId: string) => void;
};

export const ExecCards = ({ onNextSequence }: ExecCardsProps) => {
  const { cards, resume, stop, skipNext, setSpeed, close, restart } = useExecCards();
  const { program, currentChapterId } = useProgram();
  const chapterItems =
    program.chapters.find((chapter) => chapter.id === currentChapterId)?.items ??
    program.chapters[0]?.items ??
    [];

  if (cards.length === 0) {
    return <ExecEmptyState />;
  }

  return (
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      {cards.map((card) => (
        <ExecCardView
          key={card.id}
          card={card}
          hasNextSequence={
            card.status === "stopped" &&
            nextSequenceIsFree(
              chapterItems,
              card.sequenceId,
              cards.flatMap((entry) => (entry.sequenceId === undefined ? [] : [entry.sequenceId])),
            )
          }
          onStop={() => stop(card.id)}
          onResume={() => resume(card.id)}
          onRestart={() => restart(card.id)}
          onSkipNext={() => (onNextSequence ? onNextSequence(card.id) : skipNext(card.id))}
          onSetSpeed={(percent) => setSpeed(card.id, percent)}
          onClose={() => close(card.id)}
        />
      ))}
    </div>
  );
};
