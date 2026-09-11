import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { instructionBlockTitle } from "@/app/project/action-sequence/instruction-registry";
import type { ModelPose, TimelineBlock } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { VIRTUAL_AXIS_IDS } from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";

type ContextCellProps = {
  label: string;
  highlighted?: boolean;
  className?: string;
  children: ReactNode;
};

const ContextCell = ({ label, highlighted = false, className, children }: ContextCellProps) => (
  <div
    className={cn(
      "flex h-14 min-w-18 shrink-0 flex-col justify-between px-1.5 py-1",
      highlighted ? "bg-primary/15" : "bg-background",
      className,
    )}
  >
    <div className="min-h-0 min-w-18">{children}</div>
    <span className="text-[10px] text-muted-foreground">{label}</span>
  </div>
);

type ContextNumericCellProps = {
  label: string;
  value: number;
  unit?: string;
  highlighted?: boolean;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  readOnly?: boolean;
  onChange?: (value: number) => void;
};

const ContextNumericCell = ({
  label,
  value,
  unit,
  highlighted,
  min,
  max,
  step = 1,
  precision = 1,
  readOnly = false,
  onChange,
}: ContextNumericCellProps) => (
  <ContextCell label={label} highlighted={highlighted}>
    <UnitAwareNumericInput
      aria-label={label}
      value={value}
      unit={unit}
      min={min}
      max={max}
      step={step}
      precision={precision}
      readOnly={readOnly || !onChange}
      // onChange={onChange}
      onCommit={onChange}
    />
  </ContextCell>
);

const BLOCK_TITLES: Record<Exclude<TimelineBlock["kind"], "instruction">, string> = {
  pose: "位姿",
  "static-preset": "静态预设",
  "dynamic-preset": "动态预设",
};

const blockTitle = (block: TimelineBlock): string =>
  block.kind === "instruction" ? instructionBlockTitle(block) : BLOCK_TITLES[block.kind];

type PoseCellsProps = {
  pose: ModelPose;
  objectId?: number;
  onPoseChange: (pose: ModelPose) => void;
};

const poseAxisStep = (axis: VirtualAxisId): number => (axis === "v1" ? 1 : 0.1);

const PoseCells = ({ pose, objectId, onPoseChange }: PoseCellsProps) => {
  const { getTimelineObject } = useActionBuilder();
  const object = objectId === undefined ? undefined : getTimelineObject(objectId);

  return (
    <>
      {VIRTUAL_AXIS_IDS.map((axis) => {
        const range = object?.rangeByAxis?.[axis];
        return (
          <ContextNumericCell
            key={axis}
            label={axis.toUpperCase()}
            value={pose[axis]}
            unit={getVirtualAxisCanonicalUnit(axis, object?.controlType)}
            highlighted={axis === "v1"}
            min={range?.min}
            max={range?.max}
            step={poseAxisStep(axis)}
            onChange={(value) => onPoseChange({ ...pose, [axis]: value })}
          />
        );
      })}
    </>
  );
};

type BlockContextBarProps = {
  title?: string;
  block?: TimelineBlock;
  pose?: ModelPose;
  onPoseChange?: (pose: ModelPose) => void;
  onReplaceBlock?: (block: TimelineBlock) => void;
  segmentDurationMs?: number;
  onDelete?: () => void;
  children?: ReactNode;
};

export const BlockContextBar = ({
  title,
  block,
  pose,
  onPoseChange,
  onReplaceBlock,
  segmentDurationMs,
  onDelete,
  children,
}: BlockContextBarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const resolvedTitle = title ?? (block ? blockTitle(block) : "");

  return (
    <div className="flex h-14 shrink-0 items-stretch bg-card">
      <div className="w-1 shrink-0 bg-secondary" aria-hidden />

      <div className="flex h-14 min-w-16 shrink-0 flex-col justify-between bg-background px-2 py-1.5">
        <span className="text-body-sm font-medium text-foreground">{resolvedTitle}</span>
        <span className="text-[10px] text-muted-foreground">type</span>
      </div>

      {block?.kind === "pose" && onReplaceBlock ? (
        <PoseCells
          pose={block.pose}
          objectId={block.objectId}
          onPoseChange={(next) => onReplaceBlock({ ...block, pose: next })}
        />
      ) : null}

      {pose && onPoseChange ? <PoseCells pose={pose} onPoseChange={onPoseChange} /> : null}

      {block?.kind === "instruction" && block.presetId === "set-enabled" && onReplaceBlock ? (
        <>
          <ContextCell label="使能" highlighted>
            <span className="font-mono text-mono-md tabular-nums text-foreground">
              {block.instr.enabled ? "开" : "关"}
            </span>
          </ContextCell>
          <ContextNumericCell
            label="时间"
            value={block.atMs}
            unit="ms"
            step={1}
            precision={0}
            min={0}
            onChange={(atMs) => onReplaceBlock({ ...block, atMs })}
          />
        </>
      ) : null}

      {block?.kind === "static-preset" && onReplaceBlock ? (
        <ContextNumericCell
          label="时间"
          value={block.atMs}
          unit="ms"
          highlighted
          step={1}
          precision={0}
          min={0}
          onChange={(atMs) => onReplaceBlock({ ...block, atMs })}
        />
      ) : null}

      {block?.kind === "dynamic-preset" && onReplaceBlock ? (
        <>
          <ContextNumericCell
            label="开始"
            value={block.startMs}
            unit="ms"
            highlighted
            step={1}
            precision={0}
            min={0}
            onChange={(startMs) => onReplaceBlock({ ...block, startMs })}
          />
          <ContextNumericCell
            label="结束"
            value={block.endMs}
            unit="ms"
            step={1}
            precision={0}
            min={0}
            onChange={(endMs) => onReplaceBlock({ ...block, endMs })}
          />
        </>
      ) : null}

      {segmentDurationMs !== undefined ? (
        <ContextNumericCell
          label="时长"
          value={segmentDurationMs}
          unit="ms"
          highlighted
          step={1}
          precision={0}
          readOnly
        />
      ) : null}

      {children}

      <div className="min-w-0 flex-1" aria-hidden />

      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="flex h-14 min-w-16 shrink-0 items-center justify-center bg-primary/15 px-4 text-body-sm font-medium text-foreground hover:bg-primary/25"
        >
          删除
        </button>
      ) : null}

      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="更多设置"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
          className="flex h-14 w-10 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
        {menuOpen && (
          <div className="absolute bottom-full right-0 z-50 mb-1 min-w-40 rounded-md bg-card py-1 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <button type="button" className="flex w-full px-3 py-1.5 text-left text-body-sm hover:bg-muted">
              复制
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
