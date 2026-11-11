import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, Maximize2, Minimize2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/components/ui/utils";
import type { ViewPreset, ViewportCellInfo, ViewportState, Viz3DEngine } from "@/app/viz3d";
import { useViz3DContext } from "../Viz3DProvider";
import { CELL_VIEW_OPTIONS, cellTitle, cellViewValue } from "./viewport-cell-labels";
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS } from "./ViewMenu";

/** 顶栏（视图菜单那一条）的高度；顶行格子的格名放在它下面 */
const TOP_BAR_PX = 32;
const CHIP_GAP_PX = 6;
/** 搭建页左侧工具列（left-3 + 40px）右边再留一点 */
const TOOL_PALETTE_INSET_PX = 60;

const CHIP_CLASS =
  "pointer-events-auto flex h-6 items-center gap-1 rounded-md px-2 text-xs transition-colors [@media(pointer:coarse)]:h-8";

const CHIP_ICON_BTN =
  "pointer-events-auto flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground [@media(pointer:coarse)]:size-8 [&_svg]:size-3.5";

const CHIP_SURFACE = { backgroundColor: "rgba(167, 164, 163, 0.14)" } as const;

const useViewportState = (engine: Viz3DEngine): ViewportState | null => {
  const [state, setState] = useState<ViewportState | null>(() => engine.getViewportState());
  useEffect(() => {
    setState(engine.getViewportState());
    engine.events.on("viewportChange", setState);
    return () => {
      engine.events.off("viewportChange", setState);
    };
  }, [engine]);
  return state;
};

const useEngineSelection = (engine: Viz3DEngine): string[] => {
  const [selection, setSelection] = useState<string[]>(() => engine.getSelection());
  useEffect(() => {
    setSelection(engine.getSelection());
    engine.events.on("selectionChange", setSelection);
    return () => {
      engine.events.off("selectionChange", setSelection);
    };
  }, [engine]);
  return selection;
};

const percent = (ratio: number): string => `${ratio * 100}%`;

type CellChipProps = {
  cell: ViewportCellInfo;
  active: boolean;
  multiCell: boolean;
  maximized: boolean;
  leftInsetPx: number;
  primarySelectionId: string | undefined;
  onPointerGuard: (event: { stopPropagation(): void }) => void;
};

/** 每格左上角的格名：点开是这一格自己的相机菜单 */
const CellChip = ({
  cell,
  active,
  multiCell,
  maximized,
  leftInsetPx,
  primarySelectionId,
  onPointerGuard,
}: CellChipProps) => {
  const engine = useViz3DContext();
  const following = cell.followTarget != null;
  const topPx = cell.rect.top === 0 ? TOP_BAR_PX + CHIP_GAP_PX : CHIP_GAP_PX;

  const handleOpenChange = (open: boolean) => {
    if (open) {
      engine.setActiveCell(cell.id);
    }
    engine.setOrbitEnabled(!open);
  };

  return (
    <div
      className="absolute flex items-center gap-1"
      style={{
        left: `calc(${percent(cell.rect.left)} + ${leftInsetPx}px)`,
        top: `calc(${percent(cell.rect.top)} + ${topPx}px)`,
      }}
      onPointerDown={onPointerGuard}
    >
      <DropdownMenu modal={false} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${cellTitle(cell)}视口菜单`}
            aria-haspopup="menu"
            data-active={active || undefined}
            onPointerDown={onPointerGuard}
            style={CHIP_SURFACE}
            className={cn(
              CHIP_CLASS,
              multiCell && !active ? "text-muted-foreground" : "text-foreground",
              multiCell && active && "text-primary",
              "data-[state=open]:text-primary",
            )}
          >
            {cellTitle(cell)}
            {following ? <span className="text-primary">· 跟随</span> : null}
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
          <DropdownMenuLabel className="text-body-sm font-normal text-muted-foreground">
            视角
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={cellViewValue(cell)}
            onValueChange={(value) => engine.setCellView(cell.id, value as ViewPreset)}
          >
            {CELL_VIEW_OPTIONS.map(({ label, preset }) => (
              <DropdownMenuRadioItem key={preset} value={preset} className={MENU_ITEM_CLASS}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator className="bg-border/60" />
          <DropdownMenuLabel className="text-body-sm font-normal text-muted-foreground">
            投影
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={cell.orthographic ? "ortho" : "persp"}
            onValueChange={(value) => engine.setCellOrthographic(cell.id, value === "ortho")}
          >
            <DropdownMenuRadioItem value="persp" className={MENU_ITEM_CLASS}>
              透视
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="ortho" className={MENU_ITEM_CLASS}>
              正交
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator className="bg-border/60" />
          <DropdownMenuItem
            className={MENU_ITEM_CLASS}
            disabled={!primarySelectionId}
            onSelect={() => engine.focusSelection(cell.id)}
          >
            聚焦选中
          </DropdownMenuItem>
          <DropdownMenuItem
            className={cn(MENU_ITEM_CLASS, following && "text-primary")}
            disabled={!following && !primarySelectionId}
            onSelect={() =>
              engine.setCellFollowTarget(cell.id, following ? null : (primarySelectionId ?? null))
            }
          >
            {following ? "停止跟随" : "跟随选中对象"}
          </DropdownMenuItem>
          {!primarySelectionId && !following ? (
            <p className="px-2 pb-1 text-body-sm text-muted-foreground">先选中一个对象</p>
          ) : null}

          {multiCell || maximized ? (
            <>
              <DropdownMenuSeparator className="bg-border/60" />
              <DropdownMenuItem
                className={MENU_ITEM_CLASS}
                onSelect={() => engine.toggleMaximizeCell(cell.id)}
              >
                {maximized ? "还原分区" : "最大化这一格"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {multiCell || maximized ? (
        <button
          type="button"
          aria-label={maximized ? "还原分区" : "最大化这一格"}
          title={maximized ? "还原分区" : "最大化这一格"}
          onPointerDown={onPointerGuard}
          onClick={() => engine.toggleMaximizeCell(cell.id)}
          style={CHIP_SURFACE}
          className={CHIP_ICON_BTN}
        >
          {maximized ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </button>
      ) : null}
    </div>
  );
};

type DragAxis = "x" | "y" | "both";

type DividerDrag = { axis: DragAxis; pointerId: number; bounds: DOMRect };

const DIVIDER_LINE_CLASS = "bg-background transition-colors";

/** 格子之间的分隔条：拖动改比例，双击回到一半 */
const ViewportDividers = ({ state }: { state: ViewportState }) => {
  const engine = useViz3DContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DividerDrag | null>(null);
  const [dragging, setDragging] = useState<DragAxis | null>(null);
  const { split, layout } = state;

  const startDrag = (axis: DragAxis) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { axis, pointerId: event.pointerId, bounds };
    setDragging(axis);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = engine.getSplit();
    const x = (event.clientX - drag.bounds.left) / drag.bounds.width;
    const y = (event.clientY - drag.bounds.top) / drag.bounds.height;
    engine.setSplit({
      x: drag.axis === "y" ? current.x : x,
      y: drag.axis === "x" ? current.y : y,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(null);
  };

  const reset = (axis: DragAxis) => () => {
    const current = engine.getSplit();
    engine.setSplit({
      x: axis === "y" ? current.x : 0.5,
      y: axis === "x" ? current.y : 0.5,
    });
  };

  const handlers = (axis: DragAxis) => ({
    onPointerDown: startDrag(axis),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    onDoubleClick: reset(axis),
  });

  const lineActive = (axis: "x" | "y") => dragging === axis || dragging === "both";

  return (
    <div ref={rootRef} className="absolute inset-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整左右宽度，双击恢复一半"
        className="pointer-events-auto absolute inset-y-0 flex w-4 -translate-x-1/2 cursor-col-resize touch-none justify-center [@media(pointer:coarse)]:w-6"
        style={{ left: percent(split.x) }}
        {...handlers("x")}
      >
        <div className={cn("h-full w-0.5", DIVIDER_LINE_CLASS, lineActive("x") && "bg-primary/60")} />
      </div>
      {layout === "quad" ? (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="拖动调整上下高度，双击恢复一半"
            className="pointer-events-auto absolute inset-x-0 flex h-4 -translate-y-1/2 cursor-row-resize touch-none flex-col justify-center [@media(pointer:coarse)]:h-6"
            style={{ top: percent(split.y) }}
            {...handlers("y")}
          >
            <div className={cn("h-0.5 w-full", DIVIDER_LINE_CLASS, lineActive("y") && "bg-primary/60")} />
          </div>
          <div
            role="separator"
            aria-label="拖动同时调整四格大小，双击恢复均分"
            className="pointer-events-auto absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-sm bg-background [@media(pointer:coarse)]:size-7"
            style={{ left: percent(split.x), top: percent(split.y) }}
            {...handlers("both")}
          />
        </>
      ) : null}
    </div>
  );
};

type ViewportCellsOverlayProps = {
  /** 搭建页左侧工具列可见时，左列下方格子的格名让开 */
  toolPaletteVisible: boolean;
  onPointerGuard: (event: { stopPropagation(): void }) => void;
};

/** 各格的格名、最大化按钮和格间分隔条 */
export const ViewportCellsOverlay = ({ toolPaletteVisible, onPointerGuard }: ViewportCellsOverlayProps) => {
  const engine = useViz3DContext();
  const state = useViewportState(engine);
  const selection = useEngineSelection(engine);
  if (!state) return null;

  const multiCell = state.cells.length > 1;
  const showDividers = multiCell && state.maximizedCellId === null;

  return (
    <>
      {showDividers ? <ViewportDividers state={state} /> : null}
      {state.cells.map((cell) => (
        <CellChip
          key={cell.id}
          cell={cell}
          active={cell.id === state.activeCellId}
          multiCell={multiCell}
          maximized={state.maximizedCellId === cell.id}
          leftInsetPx={
            toolPaletteVisible && cell.rect.left === 0 && cell.rect.top > 0
              ? TOOL_PALETTE_INSET_PX
              : 8
          }
          primarySelectionId={selection[0]}
          onPointerGuard={onPointerGuard}
        />
      ))}
    </>
  );
};
