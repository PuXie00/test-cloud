import { AlignCenterVertical, AlignEndVertical, AlignStartVertical } from "lucide-react";
import type { ResolvedMotionSegment } from "@/app/project/action-sequence/resolve-sequence";
import type { PoseBlock } from "@/app/project/action-sequence/types";
import type { SegmentAlignEdge } from "../sequence-ops";
import { useActionBuilder } from "../use-action-builder";

const ALIGN_ROWS: Array<{
  edge: SegmentAlignEdge;
  label: string;
  extremeLabel: string;
  icon: typeof AlignStartVertical;
}> = [
  { edge: "start", label: "同时启动", extremeLabel: "到最早", icon: AlignStartVertical },
  { edge: "end", label: "同时到达", extremeLabel: "到最晚", icon: AlignEndVertical },
];

const alignButtonClass =
  "h-8 flex-1 rounded-md border border-border px-2 text-body-sm text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-10";

/**
 * 位姿对齐：选中的运动区间按物体整段平移（时长不变，后面的块跟着走），
 * 同时启动对齐起点、同时到达对齐终点；对齐到播放游标，或选中里最早的起点 / 最晚的终点。
 */
export const SegmentAlignTools = ({ segments }: { segments: ResolvedMotionSegment[] }) => {
  const { handleAlignSegments } = useActionBuilder();
  const keys = segments.map((segment) => segment.key);
  const objectCount = new Set(segments.map((segment) => segment.objectId)).size;
  const canExtreme = objectCount >= 2;

  return (
    <section aria-label="位姿对齐" className="mb-2 rounded-md bg-muted p-3">
      <p className="mb-2 text-body-sm text-muted-foreground">位姿对齐 · 整段平移，时长不变</p>
      <div className="flex flex-col gap-2">
        {ALIGN_ROWS.map(({ edge, label, extremeLabel, icon: Icon }) => (
          <div key={edge} className="flex items-center gap-2">
            <span className="flex w-[84px] shrink-0 items-center gap-1.5 text-body-sm text-foreground">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {label}
            </span>
            <button
              type="button"
              aria-label={`${label}，对齐到游标`}
              className={alignButtonClass}
              onClick={() => handleAlignSegments(keys, edge, "cursor")}
            >
              到游标
            </button>
            <button
              type="button"
              aria-label={`${label}，对齐到${extremeLabel.slice(1)}`}
              className={alignButtonClass}
              disabled={!canExtreme}
              onClick={() => handleAlignSegments(keys, edge, "extreme")}
            >
              {extremeLabel}
            </button>
          </div>
        ))}
      </div>
      {!canExtreme ? (
        <p className="mt-2 text-body-sm text-muted-foreground">选中两个以上物体的区间才能对齐到最早 / 最晚</p>
      ) : null}
    </section>
  );
};

const POSE_TARGETS = [
  { target: "cursor", label: "到游标", aria: "位姿对齐到游标" },
  { target: "earliest", label: "到最早", aria: "位姿对齐到最早" },
  { target: "latest", label: "到最晚", aria: "位姿对齐到最晚" },
] as const;

/**
 * 位姿对齐（只选了位姿，每个物体一个）：选中的位姿挪到同一时刻，这个物体后面的块跟着移，
 * 到达这个位姿的那段时长会变。对齐到播放游标，或选中位姿里最早 / 最晚的。
 */
export const PoseAlignTools = ({ poses }: { poses: readonly PoseBlock[] }) => {
  const { handleAlignPoses } = useActionBuilder();
  const ids = poses.map((pose) => pose.id);
  const canExtreme = poses.length >= 2;

  return (
    <section aria-label="位姿对齐" className="mb-2 rounded-md bg-muted p-3">
      <p className="mb-2 text-body-sm text-muted-foreground">位姿对齐 · 挪到同一时刻，后面的块跟着移</p>
      <div className="flex items-center gap-2">
        <span className="flex w-[84px] shrink-0 items-center gap-1.5 text-body-sm text-foreground">
          <AlignCenterVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          同一时刻
        </span>
        {POSE_TARGETS.map(({ target, label, aria }) => (
          <button
            key={target}
            type="button"
            aria-label={aria}
            className={alignButtonClass}
            disabled={target !== "cursor" && !canExtreme}
            onClick={() => handleAlignPoses(ids, target)}
          >
            {label}
          </button>
        ))}
      </div>
      {!canExtreme ? (
        <p className="mt-2 text-body-sm text-muted-foreground">选中两个以上物体的位姿才能对齐到最早 / 最晚</p>
      ) : null}
    </section>
  );
};
