import { useEffect, useState } from "react";
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
import { useViz3DContext } from "../Viz3DProvider";
import { SCENE_ALIGN_ACTIONS, useSceneBuildActions } from "../use-scene-build-actions";
import type { SceneObjectEditActions } from "../use-scene-object-edit-actions";

const menuContentClass =
  "z-[9999] min-w-[11rem] border border-border bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]";

const subMenuContentClass =
  "z-[9999] min-w-[8rem] border border-border bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]";

const menuItemClass = "text-body-sm";

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
  const canSingle = selection.length >= 1;
  const {
    alignSelection,
    setTransformCenter,
    groupSelection,
    ungroupSelection,
  } = useSceneBuildActions();

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
          {SCENE_ALIGN_ACTIONS.map(({ mode, label, colorClass, icon: Icon }) => (
            <DropdownMenuItem
              key={mode}
              disabled={!canMulti}
              className={menuItemClass}
              onSelect={() => alignSelection(mode)}
            >
              <Icon className={`h-4 w-4 ${colorClass}`} aria-hidden />
              <span className={colorClass}>{label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator className="bg-border" />

      <DropdownMenuItem disabled={!canMulti} className={menuItemClass} onSelect={groupSelection}>
        组合
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canSingle} className={menuItemClass} onSelect={ungroupSelection}>
        解组
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
};
