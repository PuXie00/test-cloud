import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "./project-document-empty";
import {
  areSemanticallyEqual,
  captureProjectConfiguration,
  createProjectConfigurationState,
  pushProjectHistory,
  redoProjectHistory,
  resetProjectHistory,
  restoreProjectConfiguration,
  undoProjectHistory,
} from "./project-configuration-history";

const makeDocument = () =>
  createEmptyDocument({ id: "history-project", name: "历史测试", author: "tester" });

describe("project configuration history", () => {
  it("captures only configuration roots and restores without replacing non-config roots", () => {
    const document = makeDocument();
    const snapshot = captureProjectConfiguration(document);
    const changed = {
      ...document,
      meta: { ...document.meta, name: "保留的新名称" },
      view: { ...document.view },
    };
    const restored = restoreProjectConfiguration(changed, snapshot);

    expect(snapshot.setup).toBe(document.setup);
    expect(snapshot.motion).toBe(document.motion);
    expect(snapshot.rules).toBe(document.rules);
    expect(restored.meta).toBe(changed.meta);
    expect(restored.view).toBe(changed.view);
    expect(restored.snapshots).toBe(changed.snapshots);
  });

  it("treats structurally equal configuration values as a no-op", () => {
    const document = makeDocument();
    const copied = {
      ...captureProjectConfiguration(document),
      setup: {
        ...document.setup,
        controlledObjects: [...document.setup.controlledObjects],
      },
    };
    expect(
      areSemanticallyEqual(captureProjectConfiguration(document), copied),
    ).toBe(true);
  });

  it("undoes, redoes, clears future on a new branch, and limits recoverable states", () => {
    const initialDocument = makeDocument();
    const initial = createProjectConfigurationState("s0", initialDocument);
    const changedDocument = {
      ...initialDocument,
      setup: {
        ...initialDocument.setup,
        controlledObjects: [],
      },
    };
    const changed = createProjectConfigurationState("s1", changedDocument);
    const committed = pushProjectHistory(
      resetProjectHistory(initial.id, initial.id),
      initial,
      "新增受控物体",
      1,
    );

    const undone = undoProjectHistory(committed, changed, 2);
    expect(undone?.current.id).toBe("s0");
    expect(undone?.history.future).toHaveLength(1);
    expect(undone?.history.future[0]?.state.id).toBe("s1");
    expect(undone?.history.future[0]?.label).toBe("新增受控物体");

    const redone = redoProjectHistory(undone!.history, undone!.current, 3);
    expect(redone?.current.id).toBe("s1");
    expect(redone?.label).toBe("新增受控物体");
    expect(redone?.history.future).toEqual([]);
    expect(redone?.history.past).toHaveLength(1);
    expect(redone?.history.past[0]?.state.id).toBe("s0");
    expect(redone?.history.past[0]?.label).toBe("新增受控物体");

    const branched = pushProjectHistory(
      undone!.history,
      undone!.current,
      "修改配置",
      4,
    );
    expect(branched.future).toEqual([]);

    let limited = resetProjectHistory("seed", "seed");
    for (let index = 0; index < 105; index += 1) {
      limited = pushProjectHistory(
        limited,
        { id: `s-${index}`, snapshot: captureProjectConfiguration(initialDocument) },
        `操作 ${index}`,
        index,
      );
    }
    expect(limited.past).toHaveLength(100);

    let cursor = {
      id: "current",
      snapshot: captureProjectConfiguration(initialDocument),
    };
    let stacks = limited;
    for (let index = 0; index < 100; index += 1) {
      const step = undoProjectHistory(stacks, cursor, 1000 + index);
      expect(step).not.toBeNull();
      stacks = step!.history;
      cursor = step!.current;
      expect(stacks.past.length + stacks.future.length).toBeLessThanOrEqual(100);
    }
    expect(stacks.past).toHaveLength(0);
    expect(stacks.future).toHaveLength(100);
    expect(stacks.past.length + stacks.future.length).toBeLessThanOrEqual(100);
    // 下一步 redo 在队头；最初 current 在队尾（最远可恢复）
    expect(stacks.future[0]?.state.id).toBe("s-6");
    expect(stacks.future.at(-1)?.state.id).toBe("current");

    const snapshot = captureProjectConfiguration(initialDocument);
    const bloated = {
      past: Array.from({ length: 80 }, (_, index) => ({
        state: { id: `p-${index}`, snapshot },
        label: `past ${index}`,
        committedAt: index,
      })),
      future: Array.from({ length: 80 }, (_, index) => ({
        state: { id: `f-${index}`, snapshot },
        label: `future ${index}`,
        committedAt: index,
      })),
      activeTransaction: null,
      savedStateId: "seed",
    };
    const clamped = undoProjectHistory(
      bloated,
      { id: "now", snapshot },
      9999,
    );
    expect(clamped).not.toBeNull();
    expect(
      clamped!.history.past.length + clamped!.history.future.length,
    ).toBeLessThanOrEqual(100);
    expect(clamped!.history.future[0]?.state.id).toBe("now");
    expect(clamped!.history.future[0]?.label).toBe("past 79");
  });
});
