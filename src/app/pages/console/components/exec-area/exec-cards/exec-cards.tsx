import { useExecCards, type ExecCard } from "../../../hooks/use-exec-cards";
import { getSequenceTransport, stopSequence } from "../../../hooks/sequence-execution";
import { useProgram } from "../../../hooks/use-program";
import { hasNextChapterSequence } from "../../../hooks/sequence-run-status";
import { ExecCardView } from "./exec-card";
import { ExecEmptyState } from "./exec-empty-state";

export const ExecCards = () => {
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
            card.sequenceId !== undefined &&
            hasNextChapterSequence(chapterItems, card.sequenceId)
          }
          onStop={() => stop(card.id)}
          onResume={() => resume(card.id)}
          onRestart={() => restart(card.id)}
          onSkipNext={() => skipNext(card.id)}
          onSetSpeed={(percent) => setSpeed(card.id, percent)}
          onClose={() => dismissExecCard(card, close)}
        />
      ))}
    </div>
  );
};

export const dismissExecCard = (card: ExecCard, close: (id: string) => void): void => {
  if (card.sequenceHandle && card.status !== "completed") {
    void stopSequence(card.sequenceHandle, getSequenceTransport()).catch(() => undefined);
  }
  close(card.id);
};
