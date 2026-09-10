import { List } from "lucide-react";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { countSequenceBlocks, formatTime } from "../timeline/timeline-data";

type SequenceContextBarProps = {
  sequence: ActionSequenceConfig;
  totalMs: number;
};

const collectModelCount = (sequence: ActionSequenceConfig): number => {
  const objectIds = new Set<number>();
  for (const block of sequence.blocks) {
    if ("objectId" in block && typeof block.objectId === "number") {
      objectIds.add(block.objectId);
    }
    if ("orderedObjectIds" in block) {
      block.orderedObjectIds.forEach((objectId) => objectIds.add(objectId));
    }
  }
  return objectIds.size;
};

export const SequenceContextBar = ({ sequence, totalMs }: SequenceContextBarProps) => {
  const blockCount = countSequenceBlocks(sequence);
  const modelCount = collectModelCount(sequence);

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 bg-card px-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted">
        <List className="h-4 w-4 text-secondary" aria-hidden />
      </div>

      <div className="min-w-0">
        <p className="truncate text-body-sm font-medium text-foreground">{sequence.name}</p>
        <p className="text-[10px] text-muted-foreground">动作序列</p>
      </div>

      <div className="flex gap-6">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground">编排时长</span>
          <span className="font-mono text-mono-md tabular-nums text-foreground">
            {formatTime(totalMs)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground">模型</span>
          <span className="font-mono text-mono-md tabular-nums text-foreground">{modelCount}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground">指令</span>
          <span className="font-mono text-mono-md tabular-nums text-foreground">{blockCount}</span>
        </div>
      </div>

      <div className="min-w-0 flex-1" aria-hidden />
    </div>
  );
};
