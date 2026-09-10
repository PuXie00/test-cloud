import { MousePointerClick } from "lucide-react";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  MotionSegmentSettings,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import { lookupSequenceSelection, type SequenceSelection } from "../sequence-selection";
import { useActionBuilder } from "../use-action-builder";
import { BlockContextBar } from "./block-context-bar";
import { ObjectContextBar } from "./object-context-bar";
import { SequenceContextBar } from "./sequence-context-bar";

export type ContextSelection =
  | { kind: "block"; blockId: string }
  | { kind: "object"; objectId: number }
  | { kind: "sequence"; sequenceId: string };

type SelectionContextBarProps = {
  sequence: ActionSequenceConfig | null;
  resolved: ResolvedActionSequence | null;
  selection: SequenceSelection;
  selectedObjectIds: number[];
  onReplaceBlock: (block: TimelineBlock) => void;
  onUpdateSegment: (
    fromRef: string,
    toRef: string,
    settings: MotionSegmentSettings,
  ) => void;
  onDeleteBlock: (blockId: string) => void;
};

const EmptyBar = ({ message }: { message: string }) => (
  <div className="flex h-14 shrink-0 items-center justify-center gap-2 bg-card px-4 text-body-sm text-muted-foreground">
    <MousePointerClick className="h-4 w-4" aria-hidden />
    {message}
  </div>
);

export const SelectionContextBar = ({
  sequence,
  resolved,
  selection,
  selectedObjectIds,
  onReplaceBlock,
  onUpdateSegment,
  onDeleteBlock,
}: SelectionContextBarProps) => {
  const { getTimelineObject } = useActionBuilder();
  const lookup =
    sequence === null
      ? null
      : lookupSequenceSelection(sequence, selection, resolved ?? undefined);

  if (lookup?.kind === "block") {
    return (
      <BlockContextBar
        block={lookup.block}
        onReplaceBlock={onReplaceBlock}
        onDelete={() => onDeleteBlock(lookup.block.id)}
      />
    );
  }

  if (lookup?.kind === "segment") {
    return (
      <BlockContextBar
        title="运动区间"
        segmentDurationMs={lookup.segment.durationMs}
      />
    );
  }

  if (selectedObjectIds.length === 1) {
    const objectId = selectedObjectIds[0];
    const object = objectId === undefined ? undefined : getTimelineObject(objectId);
    if (!object) {
      return <EmptyBar message="受控物体不存在" />;
    }
    return <ObjectContextBar object={object} />;
  }

  if (sequence) {
    return (
      <SequenceContextBar sequence={sequence} totalMs={resolved?.totalMs ?? 0} />
    );
  }

  return <EmptyBar message="选择动作序列、受控物体或时间轴项目以编辑" />;
};
