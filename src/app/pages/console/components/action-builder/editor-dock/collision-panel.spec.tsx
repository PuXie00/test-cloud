// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import type { CollisionReport } from "@/app/project/collision/types";
import { Viz3DEngine } from "@/app/viz3d/engine/Viz3DEngine";
import { ViewMenu } from "../../../3d/overlays/ViewMenu";
import { TimelineToolbar } from "../timeline/timeline-toolbar";
import { CollisionPanel } from "./collision-panel";
import { CollisionMenuProvider, usePublishCollisionMenu } from "./collision-menu-context";

const engine = new Viz3DEngine();
vi.mock("../../../3d/Viz3DProvider", () => ({ useViz3DContext: () => engine }));
afterEach(cleanup);

const report: CollisionReport = {
  events: [{ objectIds: [7, 8], kind: "collision", startMs: 157.5, endMs: 190 }],
  incomplete: ["布景 C 缺少模型"],
};
const names = new Map([[7, "升降架"], [8, "布景"]]);

const openCollision = vi.fn();

function ActiveSequence() {
  const publish = usePublishCollisionMenu();
  useLayoutEffect(() => {
    publish({ open: openCollision, label: "" });
    return () => publish(null);
  }, [publish]);
  return null;
}

const openMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole("button", { name, exact: true }), { key: "ArrowDown" });

describe("action editor collision detection", () => {
  it("offers a manual check in the timeline View menu when a sequence is active", () => {
    openCollision.mockClear();
    const tree = (active: boolean) => <CollisionMenuProvider>
      {active && <ActiveSequence />}
      <TimelineToolbar viewMode="tracks" onViewModeChange={() => {}} pxPerSecond={100} canDelete={false} />
    </CollisionMenuProvider>;
    const view = render(tree(false));
    openMenu("视图");
    expect(screen.queryByRole("menuitem", { name: "碰撞检测" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    view.rerender(tree(true));
    openMenu("视图");
    expect(screen.queryByText(/待检测|待更新/)).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "碰撞检测" }));
    expect(openCollision).toHaveBeenCalledOnce();
  });

  it("keeps collision detection out of the 3D viewport View menu even on the actions page", () => {
    render(<CollisionMenuProvider><ActiveSequence /><ViewMenu showMotionPaths /></CollisionMenuProvider>);
    openMenu("视图菜单");
    expect(screen.getByRole("menuitem", { name: "轨迹" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "碰撞检测" })).toBeNull();
  });

  it("locates both objects at the first confirmed contact in a saved report", () => {
    const onLocate = vi.fn();
    const close = vi.fn();
    render(<CollisionPanel open onOpenChange={close} status="ready" report={report} error={null} names={names}
      onLocate={onLocate} runFull={vi.fn()} />);
    const dialog = within(screen.getByRole("dialog", { name: "碰撞检测" }));
    expect(dialog.getByText("布景 C 缺少模型")).toBeDefined();
    fireEvent.click(dialog.getByRole("button", { name: /升降架.*布景/ }));
    expect(onLocate).toHaveBeenCalledWith(report.events[0]);
    expect(close).toHaveBeenCalledWith(false);
  });

  it("displays a paused check without stale findings", () => {
    render(<CollisionPanel open onOpenChange={vi.fn()} status="paused" report={report} error={null}
      names={names} onLocate={vi.fn()} runFull={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/暂停.*停止播放.*继续/);
    expect(screen.queryByRole("button", { name: /升降架.*布景/ })).toBeNull();
  });
});
