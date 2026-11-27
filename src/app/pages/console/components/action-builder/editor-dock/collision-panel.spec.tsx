// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import type { CollisionReport } from "@/app/project/collision/types";
import { Viz3DEngine } from "@/app/viz3d/engine/Viz3DEngine";
import { ViewMenu } from "../../../3d/overlays/ViewMenu";
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

describe("viewport collision detection", () => {
  it("offers the manual command for the active sequence with no ordinary-edit status", () => {
    const open = vi.fn();
    function ActiveSequence() {
      const publish = usePublishCollisionMenu();
      useLayoutEffect(() => { publish({ open, label: "" }); return () => publish(null); }, [publish]);
      return null;
    }
    const tree = (inEditor: boolean) => <CollisionMenuProvider>
      {inEditor && <ActiveSequence />}
      <ViewMenu showMotionPaths />
    </CollisionMenuProvider>;
    const view = render(tree(false));
    const openMenu = () => fireEvent.keyDown(screen.getByRole("button", { name: "视图菜单" }), { key: "ArrowDown" });
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "碰撞检测" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    view.rerender(tree(true));
    openMenu();
    expect(screen.queryByText(/待检测|待更新/)).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "碰撞检测" }));
    expect(open).toHaveBeenCalledOnce();
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
