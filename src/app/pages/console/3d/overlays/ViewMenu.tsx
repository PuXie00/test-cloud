import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/components/ui/utils";
import type { GridSizeM, HoistLabelMode, ViewPreset, ViewportLayout } from "@/app/viz3d";
import {
  parseHoistLabelMode,
  readStoredHoistLabelMode,
  writeStoredHoistLabelMode,
} from "@/app/viz3d";
import { isOrthographicViewPreset } from "@/app/viz3d/cameras/ViewPresets";
import { GRID_SIZE_PRESETS, isGridSizeM } from "@/app/viz3d/helpers/grid-config";
import { useViz3DContext } from "../Viz3DProvider";

const MENU_CONTENT_CLASS =
  "z-[200] min-w-[11rem] overflow-visible border border-border bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-100 data-[state=open]:duration-75 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-100 data-[state=closed]:duration-75 data-[side=bottom]:slide-in-from-top-0 data-[side=left]:slide-in-from-right-0 data-[side=right]:slide-in-from-left-0 data-[side=top]:slide-in-from-bottom-0";

const FLYOUT_PANEL_CLASS =
  "absolute left-full top-0 z-[201] ml-0.5 min-w-[8rem] rounded-md border border-border bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]";

const MENU_ITEM_CLASS = "text-body-sm";

const SUB_TRIGGER_CLASS =
  "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-body-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground";

const LAYOUT_OPTIONS: { label: string; layout: ViewportLayout }[] = [
  { label: "单视图", layout: "single" },
  { label: "双视图", layout: "dual" },
  { label: "四视图", layout: "quad" },
];

const VIEW_OPTIONS: { label: string; preset: ViewPreset }[] = [
  { label: "顶视图", preset: "top" },
  { label: "前视图", preset: "front" },
  { label: "右视图", preset: "side" },
  { label: "左视图", preset: "left" },
  { label: "后视图", preset: "back" },
];

const GRID_SIZE_OPTIONS: { label: string; size: GridSizeM }[] = GRID_SIZE_PRESETS.map((size) => ({
  label: `${size} m`,
  size,
}));

const LABEL_MODE_OPTIONS: { label: string; mode: HoistLabelMode }[] = [
  { label: "吊点序号", mode: "hoist" },
  { label: "电机序号", mode: "motor" },
];

type FlyoutId = "region" | "view" | "grid" | "label";

type ViewMenuFlyoutProps = {
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPointerGuard?: (event: { stopPropagation(): void }) => void;
  children: ReactNode;
};

/** 同面板 flyout：外观同子菜单，无 Radix Sub 悬停延迟与双层动画 */
const ViewMenuFlyout = ({
  label,
  open,
  onOpen,
  onClose,
  onPointerGuard,
  children,
}: ViewMenuFlyoutProps) => {
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeaveTimer = () => {
    if (leaveTimerRef.current != null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const handleEnter = () => {
    clearLeaveTimer();
    onOpen();
  };

  const handleLeave = () => {
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(onClose, 60);
  };

  useEffect(() => () => clearLeaveTimer(), []);

  return (
    <div
      className="relative"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      <div
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(SUB_TRIGGER_CLASS, open && "bg-accent text-accent-foreground")}
        onPointerDown={onPointerGuard}
      >
        {label}
        <ChevronRight className="ml-auto size-4 opacity-70" aria-hidden />
      </div>
      {open ? (
        <div
          className={FLYOUT_PANEL_CLASS}
          onPointerDown={onPointerGuard}
          onClick={onPointerGuard}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};

type ViewMenuProps = {
  onPointerGuard?: (event: { stopPropagation(): void }) => void;
};

export const ViewMenu = ({ onPointerGuard }: ViewMenuProps) => {
  const engine = useViz3DContext();
  const [layout, setLayout] = useState<ViewportLayout>(() => engine.getLayout());
  const [activeView, setActiveView] = useState<ViewPreset | null>(null);
  const [gridSize, setGridSize] = useState<GridSizeM>(() => engine.getGridSize());
  const [labelMode, setLabelMode] = useState<HoistLabelMode>(() => engine.getHoistLabelMode());
  const [selection, setSelection] = useState<string[]>(() => engine.getSelection());
  const [followTarget, setFollowTarget] = useState<string | null>(() => engine.getFollowTarget());
  const [openFlyout, setOpenFlyout] = useState<FlyoutId | null>(null);

  useEffect(() => {
    const handleLayout = (next: ViewportLayout) => setLayout(next);
    const handleView = (next: ViewPreset) => setActiveView(next);
    const handleGridSize = (next: GridSizeM) => setGridSize(next);
    const handleSelection = (ids: string[]) => setSelection(ids);
    const handleLabelMode = (next: HoistLabelMode) => setLabelMode(next);

    engine.events.on("layoutChange", handleLayout);
    engine.events.on("viewChange", handleView);
    engine.events.on("gridSizeChange", handleGridSize);
    engine.events.on("selectionChange", handleSelection);
    engine.events.on("hoistLabelModeChange", handleLabelMode);
    setGridSize(engine.getGridSize());

    const stored = readStoredHoistLabelMode();
    engine.setHoistLabelMode(stored);
    setLabelMode(engine.getHoistLabelMode());

    return () => {
      engine.events.off("layoutChange", handleLayout);
      engine.events.off("viewChange", handleView);
      engine.events.off("gridSizeChange", handleGridSize);
      engine.events.off("selectionChange", handleSelection);
      engine.events.off("hoistLabelModeChange", handleLabelMode);
    };
  }, [engine]);

  const primaryId = selection[0];
  const isFollowing = followTarget != null;
  const canFollow = Boolean(primaryId);

  const handleOpenChange = (next: boolean) => {
    if (!next) setOpenFlyout(null);
    engine.setOrbitEnabled(!next);
  };

  const handleLayout = (value: string) => {
    engine.setLayout(value as ViewportLayout);
  };

  const handleView = (preset: ViewPreset) => {
    engine.setView(preset);
  };

  const handleGridSize = (value: string) => {
    const next = Number(value);
    if (!isGridSizeM(next)) return;
    engine.setGridSize(next);
    setGridSize(next);
  };

  const handleLabelModeChange = (value: string) => {
    const next = parseHoistLabelMode(value);
    engine.setHoistLabelMode(next);
    writeStoredHoistLabelMode(next);
    setLabelMode(next);
  };

  const handleToggleFollow = () => {
    if (isFollowing) {
      engine.setFollowTarget(null);
      setFollowTarget(null);
      return;
    }
    if (!primaryId) return;
    engine.setFollowTarget(primaryId);
    setFollowTarget(primaryId);
  };

  const openFlyoutId = (id: FlyoutId) => () => setOpenFlyout(id);

  return (
    <DropdownMenu modal={false} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="视图菜单"
          aria-haspopup="menu"
          onPointerDown={onPointerGuard}
          className={cn(
            "pointer-events-auto flex h-6 items-center gap-1 rounded-md px-2 text-xs transition-colors",
            "text-foreground hover:bg-card data-[state=open]:bg-card data-[state=open]:text-primary",
          )}
        >
          视图
          <ChevronDown className="size-3.5 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className={MENU_CONTENT_CLASS}
        onPointerDown={onPointerGuard}
        onClick={onPointerGuard}
      >
        <ViewMenuFlyout
          label="区域"
          open={openFlyout === "region"}
          onOpen={openFlyoutId("region")}
          onClose={() => setOpenFlyout((current) => (current === "region" ? null : current))}
          onPointerGuard={onPointerGuard}
        >
          <DropdownMenuRadioGroup value={layout} onValueChange={handleLayout}>
            {LAYOUT_OPTIONS.map(({ label, layout: value }) => (
              <DropdownMenuRadioItem key={value} value={value} className={MENU_ITEM_CLASS}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </ViewMenuFlyout>

        <ViewMenuFlyout
          label="视图"
          open={openFlyout === "view"}
          onOpen={openFlyoutId("view")}
          onClose={() => setOpenFlyout((current) => (current === "view" ? null : current))}
          onPointerGuard={onPointerGuard}
        >
          <DropdownMenuRadioGroup
            value={activeView ?? ""}
            onValueChange={(value) => handleView(value as ViewPreset)}
          >
            {VIEW_OPTIONS.map(({ label, preset }) => (
              <DropdownMenuRadioItem key={preset} value={preset} className={MENU_ITEM_CLASS}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </ViewMenuFlyout>

        <ViewMenuFlyout
          label="网格"
          open={openFlyout === "grid"}
          onOpen={openFlyoutId("grid")}
          onClose={() => setOpenFlyout((current) => (current === "grid" ? null : current))}
          onPointerGuard={onPointerGuard}
        >
          <DropdownMenuRadioGroup value={String(gridSize)} onValueChange={handleGridSize}>
            {GRID_SIZE_OPTIONS.map(({ label, size }) => (
              <DropdownMenuRadioItem key={size} value={String(size)} className={MENU_ITEM_CLASS}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </ViewMenuFlyout>

        <ViewMenuFlyout
          label="标签"
          open={openFlyout === "label"}
          onOpen={openFlyoutId("label")}
          onClose={() => setOpenFlyout((current) => (current === "label" ? null : current))}
          onPointerGuard={onPointerGuard}
        >
          <DropdownMenuRadioGroup value={labelMode} onValueChange={handleLabelModeChange}>
            {LABEL_MODE_OPTIONS.map(({ label, mode }) => (
              <DropdownMenuRadioItem key={mode} value={mode} className={MENU_ITEM_CLASS}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </ViewMenuFlyout>

        <DropdownMenuSeparator className="bg-border/60" />

        <DropdownMenuItem
          className={MENU_ITEM_CLASS}
          onSelect={() => {
            if (isOrthographicViewPreset(engine.getViewPreset())) {
              engine.setView("persp");
            } else {
              engine.setOrthographicEnabled(false);
            }
          }}
        >
          透视
        </DropdownMenuItem>
        <DropdownMenuItem
          className={MENU_ITEM_CLASS}
          onSelect={() => engine.setOrthographicEnabled(true)}
        >
          正交
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-border/60" />

        <DropdownMenuItem
          className={cn(MENU_ITEM_CLASS, isFollowing && "text-primary")}
          disabled={!canFollow && !isFollowing}
          title={!primaryId && !isFollowing ? "请先选中一个对象" : undefined}
          onSelect={handleToggleFollow}
        >
          {isFollowing ? "停止跟随" : "跟随选中对象"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
