import { useEffect, useMemo, useState } from "react";
import type { ToolMode, TransformCenterPreset } from "@/app/viz3d";
import { isBuildMenuToolMode } from "@/app/viz3d";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/components/ui/utils";
import { canMountTo, orderByMountTree } from "@/app/project/object-mount";
import { useProjectStore } from "../../hooks/use-project-store";
import { useViz3DContext } from "../Viz3DProvider";
import {
  SCENE_AXES,
  SCENE_DISTRIBUTE_MIN_COUNT,
  useSceneBuildActions,
} from "../use-scene-build-actions";
import type { SceneObjectEditActions } from "../use-scene-object-edit-actions";

const menuContentClass =
  "z-[9999] min-w-[11rem] border border-border bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]";

const subMenuContentClass =
  "z-[9999] min-w-[8rem] border border-border bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]";

const menuItemClass = "text-body-sm";

const mountListClass = `${subMenuContentClass} max-h-72 overflow-y-auto`;

const TRANSFORM_CENTER_PRESETS: Array<{
  label: string;
  preset: TransformCenterPreset;
}> = [
  { label: "几何中心", preset: "geometry" },
  { label: "顶部中心", preset: "top" },
  { label: "底部中心", preset: "bottom" },
];

type SceneBuildContextMenuContentProps = {
  copySelection: SceneObjectEditActions["copySelection"];
  pasteClipboard: SceneObjectEditActions["pasteClipboard"];
  requestDeleteSelection: SceneObjectEditActions["requestDeleteSelection"];
  canCopy: boolean;
  canPaste: boolean;
  canDelete: boolean;
  contextObjectId: string | null;
};

const EditMenuItems = ({
  copySelection,
  pasteClipboard,
  requestDeleteSelection,
  canCopy,
  canPaste,
  canDelete,
}: SceneBuildContextMenuContentProps) => (
  <>
    <DropdownMenuItem
      disabled={!canCopy}
      className={menuItemClass}
      onSelect={copySelection}
    >
      复制
    </DropdownMenuItem>
    <DropdownMenuItem
      disabled={!canPaste}
      className={menuItemClass}
      onSelect={() => pasteClipboard("menu")}
    >
      粘贴
    </DropdownMenuItem>
    <DropdownMenuItem
      variant="destructive"
      disabled={!canDelete}
      className={menuItemClass}
      onSelect={requestDeleteSelection}
    >
      删除
    </DropdownMenuItem>
  </>
);

/** Viewport object/build menu — used with controlled DropdownMenu at cursor. */
export const SceneBuildContextMenuContent = (props: SceneBuildContextMenuContentProps) => {
  const engine = useViz3DContext();
  const [mode, setMode] = useState<ToolMode>(() => engine.getMode());
  const [selection, setSelection] = useState(() => engine.getSelection());
  const canMulti = selection.length >= 2;
  const canDistribute = selection.length >= SCENE_DISTRIBUTE_MIN_COUNT;
  const {
    alignSelection,
    distributeSelection,
    setTransformCenter,
  } = useSceneBuildActions();
  const { objects, mountObjects } = useProjectStore();
  const selectedObjectIds = useMemo(() => selection.map(Number), [selection]);
  /** 所有选中物体都能挂上去的候选父物体（挂载树顺序） */
  const mountTargets = useMemo(
    () =>
      selectedObjectIds.length === 0
        ? []
        : orderByMountTree(objects).filter(({ object }) =>
            selectedObjectIds.every((id) => canMountTo(objects, id, object.id)),
          ),
    [objects, selectedObjectIds],
  );
  const canUnmount = objects.some(
    (object) => selectedObjectIds.includes(object.id) && object.parentId != null,
  );

  useEffect(() => {
    const handleMode = (next: ToolMode) => setMode(next);
    const handleSelection = () => setSelection(engine.getSelection());
    engine.events.on("modeChange", handleMode);
    engine.events.on("selectionChange", handleSelection);
    return () => {
      engine.events.off("modeChange", handleMode);
      engine.events.off("selectionChange", handleSelection);
    };
  }, [engine]);

  if (!isBuildMenuToolMode(mode)) {
    return (
      <DropdownMenuContent className={menuContentClass} align="start" side="right" sideOffset={2}>
        <EditMenuItems {...props} />
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem disabled className={menuItemClass}>
          测量模式不可用
        </DropdownMenuItem>
      </DropdownMenuContent>
    );
  }

  return (
    <DropdownMenuContent className={menuContentClass} align="start" side="right" sideOffset={2}>
      <EditMenuItems {...props} />
      <DropdownMenuSeparator className="bg-border" />

      {props.contextObjectId ? (
        <>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={menuItemClass}>
              设置变换中心
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={subMenuContentClass}>
              {TRANSFORM_CENTER_PRESETS.map(({ label, preset }) => (
                <DropdownMenuItem
                  key={preset}
                  className={menuItemClass}
                  onSelect={() => setTransformCenter(props.contextObjectId!, preset)}
                >
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                className={menuItemClass}
                onSelect={() => setTransformCenter(props.contextObjectId!, "reset")}
              >
                重置
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator className="bg-border" />
        </>
      ) : null}

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={menuItemClass}>
          对齐
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={subMenuContentClass}>
          {SCENE_AXES.flatMap(({ axis, letter, name, colorClass, iconClass, edges }) =>
            edges.map(({ edge, label, icon: Icon }) => (
              <DropdownMenuItem
                key={`${axis}-${edge}`}
                disabled={!canMulti}
                className={menuItemClass}
                onSelect={() => alignSelection(axis, edge)}
              >
                <Icon className={cn("h-4 w-4", colorClass, iconClass)} aria-hidden />
                <span className={cn("font-mono", colorClass)}>{letter}</span>
                {name} · {label}
              </DropdownMenuItem>
            )),
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!canDistribute} className={menuItemClass}>
          {canDistribute ? "均布" : `均布（至少 ${SCENE_DISTRIBUTE_MIN_COUNT} 个物体）`}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={subMenuContentClass}>
          {SCENE_AXES.map(({ axis, letter, name, colorClass, iconClass, distributeIcon: Icon }) => (
            <DropdownMenuItem
              key={axis}
              className={menuItemClass}
              onSelect={() => distributeSelection(axis)}
            >
              <Icon className={cn("h-4 w-4", colorClass, iconClass)} aria-hidden />
              <span className={cn("font-mono", colorClass)}>{letter}</span>
              {name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator className="bg-border" />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          disabled={mountTargets.length === 0}
          className={menuItemClass}
        >
          挂载到
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={mountListClass}>
          {mountTargets.map(({ object, depth }) => (
            <DropdownMenuItem
              key={object.id}
              className={menuItemClass}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              onSelect={() => mountObjects(selectedObjectIds, object.id)}
            >
              {object.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        disabled={!canUnmount}
        className={menuItemClass}
        onSelect={() => mountObjects(selectedObjectIds, null)}
      >
        解除挂载
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
};
