import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useSequenceCollision } from "@/app/project/collision/use-sequence-collision";
import type { ActionSequenceConfig, ModelPose } from "@/app/project/action-sequence/types";
import type { CollisionEvent } from "@/app/project/collision/types";
import { useConsoleNav } from "../../../hooks/use-console-nav";
import { useSelection } from "../../../hooks/use-selection";
import { useSequencePreview, useSequencePreviewPlaying } from "../../../hooks/use-sequence-preview";
import { useActionBuilder } from "../use-action-builder";
import { indexCollisionTimes, type CollisionPreview, type CollisionSource } from "../collision-preview";
import { CollisionPanel } from "./collision-panel";
import { usePublishCollisionMenu } from "./collision-menu-context";

type Props = {
  sequence: ActionSequenceConfig | null;
  source: CollisionSource | null;
  playing: boolean;
  onPreview: (preview: CollisionPreview | null) => void;
  onLocate: (event: CollisionEvent) => void;
};

const emptyPoses = () => new Map<number, Partial<ModelPose>>();

// 只有对话框开着才订阅节目预览，播放游标变化时复用同一份报告视图。
const MemoCollisionPanel = memo(CollisionPanel);
const InspectCollisionPanel = ({ onLocate, ...props }: ComponentProps<typeof CollisionPanel>) => {
  const { stopPreview } = useSequencePreview();
  const locate = useCallback((event: CollisionEvent) => {
    stopPreview();
    onLocate(event);
  }, [stopPreview, onLocate]);
  return <MemoCollisionPanel {...props} onLocate={locate} />;
};

const scanLabel = ({ status, report }: ReturnType<typeof useSequenceCollision>): string => {
  switch (status) {
    case "running": return "检测中";
    case "paused": return "已暂停";
    case "queued": return "已排队";
    case "failed": return "检测失败";
    case "ready":
      if (report?.events.length) return `${report.events.length} 项`;
      return report?.incomplete.length ? "未完整校验" : "未发现碰撞";
    default: return "";
  }
};

/** 任务跟随控台会话；关闭菜单、切换页签或取消选择仍可完成保存触发的扫描。 */
const SequenceCollisionControl = memo(function SequenceCollisionControl({ sequence, source, playing, onPreview, onLocate }: Props) {
  const setup = source?.setup ?? null;
  const scan = useSequenceCollision(sequence, setup, source?.projectKey ?? null,
    playing || !!source?.dragging, source?.readBasePoses ?? emptyPoses, source?.savedBatch ?? null);
  const { report, basePoses, status, runFull } = scan;
  const [opened, setOpened] = useState(false);
  const publish = usePublishCollisionMenu();
  const names = useMemo(() => new Map(setup?.controlledObjects.map((object) => [object.id, object.name])), [setup?.controlledObjects]);
  // 编辑时更新命令读取的草稿，避免向视图菜单重复发布同一个入口。
  const command = useRef({ status, runFull });
  useLayoutEffect(() => { command.current = { status, runFull }; }, [status, runFull]);
  const open = useCallback(() => {
    setOpened(true);
    const current = command.current;
    if (current.status === "idle" || current.status === "failed") current.runFull();
  }, []);
  const label = scanLabel(scan);
  const available = !!sequence && !!setup;
  useLayoutEffect(() => {
    if (!available) return;
    publish({ open, label });
    return () => publish(null);
  }, [available, open, label, publish]);
  useEffect(() => setOpened(false), [sequence?.id, source?.projectKey]);

  useEffect(() => {
    if (!sequence || !setup || status !== "ready" || !report || !basePoses) return;
    onPreview({ sequence, setup, basePoses, times: indexCollisionTimes(report.events) });
    return () => onPreview(null);
  }, [status, report, basePoses, sequence, setup, onPreview]);

  if (!opened || !sequence || !setup) return null;
  return <InspectCollisionPanel {...scan} open onOpenChange={setOpened} names={names} onLocate={onLocate} />;
});

export const SequenceCollisionBridge = () => {
  const builder = useActionBuilder();
  const { activeNav } = useConsoleNav();
  const previewPlaying = useSequencePreviewPlaying();
  const { replaceSelection } = useSelection();
  const { handleLocateCollision, handleObjectsFollow } = builder;
  const locate = useCallback((event: CollisionEvent) => {
    handleLocateCollision(event.startMs);
    handleObjectsFollow(event.objectIds);
    replaceSelection(event.objectIds);
  }, [handleLocateCollision, handleObjectsFollow, replaceSelection]);

  return <SequenceCollisionControl sequence={activeNav === "sequences" ? builder.sequence : null}
    source={builder.collisionSource} playing={previewPlaying || builder.timelinePlaying}
    onPreview={builder.setCollisionPreview} onLocate={locate} />;
};
