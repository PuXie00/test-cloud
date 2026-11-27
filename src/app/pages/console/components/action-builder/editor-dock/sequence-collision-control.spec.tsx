// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { CollisionMenuProvider, useCollisionMenu } from "./collision-menu-context";
import { SequenceCollisionBridge } from "./sequence-collision-control";

const m = vi.hoisted(() => ({
  activeNav: "sequences", playing: false, timelinePlaying: false, cursorMs: 0, scan: vi.fn(), runFull: vi.fn(),
  stopPreview: vi.fn(), onPreview: vi.fn(), onLocate: vi.fn(), follow: vi.fn(), replace: vi.fn(),
}));
const draft = { id: 7, blocks: [], segments: [] } as unknown as ActionSequenceConfig;
const setup = { controlledObjects: [] };
const source = { setup, projectKey: "stage", dragging: false, readBasePoses: () => new Map(),
  savedBatch: { projectKey: "stage", sequences: [{ ...draft }] } };

vi.mock("@/app/project/collision/use-sequence-collision", () => ({ useSequenceCollision: m.scan }));
vi.mock("../../../hooks/use-console-nav", () => ({ useConsoleNav: () => ({ activeNav: m.activeNav }) }));
vi.mock("../../../hooks/use-selection", () => ({ useSelection: () => ({ replaceSelection: m.replace }) }));
vi.mock("../../../hooks/use-sequence-preview", () => ({ useSequencePreviewPlaying: () => m.playing, useSequencePreview: () => ({ stopPreview: m.stopPreview }) }));
vi.mock("../use-action-builder", () => ({ useActionBuilder: () => ({
  sequence: draft, timelinePlaying: m.timelinePlaying, cursorMs: m.cursorMs, collisionSource: source,
  handleLocateCollision: m.onLocate, handleObjectsFollow: m.follow, setCollisionPreview: m.onPreview,
}) }));

function Command() {
  const command = useCollisionMenu();
  return command ? <button onClick={command.open}>手动检测</button> : null;
}

function renderTree() {
  return <CollisionMenuProvider><SequenceCollisionBridge /><Command /></CollisionMenuProvider>;
}

describe("collision command and background scans", () => {
  beforeEach(() => {
    m.activeNav = "sequences"; m.timelinePlaying = false; m.playing = false;
    m.scan.mockReturnValue({ status: "idle", report: null, basePoses: null, error: null, runFull: m.runFull });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("runs a manual scan only on request, independently of dialog and cursor changes", () => {
    const view = render(renderTree());
    const initialCalls = m.scan.mock.calls.length;
    m.cursorMs += 100;
    view.rerender(renderTree());
    expect(m.scan).toHaveBeenCalledTimes(initialCalls);
    expect(m.runFull).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "手动检测" }));
    expect(m.runFull).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(m.scan.mock.lastCall?.[0]).toBe(draft);
  });

  it("opens a valid report without scanning again and stops a program preview before locating", () => {
    m.scan.mockReturnValue({ status: "ready", report: {
      events: [{ kind: "collision", objectIds: [7, 8], startMs: 156.75, endMs: 168 }], incomplete: [],
    }, basePoses: new Map(), error: null, runFull: m.runFull });
    render(renderTree());
    fireEvent.click(screen.getByRole("button", { name: "手动检测" }));
    expect(m.runFull).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /7.*8/ }));
    expect(m.stopPreview).toHaveBeenCalledOnce();
    expect(m.onLocate).toHaveBeenCalledWith(156.75);
    expect(m.replace).toHaveBeenCalledWith([7, 8]);
  });

  it("keeps saved batches available off the editor and pauses for either playback mode", () => {
    m.timelinePlaying = true;
    const view = render(renderTree());
    expect(m.scan.mock.lastCall).toEqual([draft, setup, "stage", true, source.readBasePoses, source.savedBatch]);
    m.activeNav = "control"; m.timelinePlaying = false; m.playing = true;
    view.rerender(renderTree());
    expect(m.scan.mock.lastCall).toEqual([null, setup, "stage", true, source.readBasePoses, source.savedBatch]);
    expect(screen.queryByRole("button", { name: "手动检测" })).toBeNull();
    m.playing = false;
    view.rerender(renderTree());
    expect(m.scan.mock.lastCall?.[3]).toBe(false);
  });
});
