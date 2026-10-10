import { describe, expect, it } from "vitest";
import {
  buildAiConsoleView,
  resolveAiPage,
  type AiConsoleViewInput,
} from "../src/app/ai-bridge/ai-view";

const names = {
  plcs: { "1": "主控PLC-01" },
  motors: { "11": "Hoist-C-1", "12": "Hoist-C-2" },
  objects: { "21": "主幕", "22": "侧幕" },
  sequences: { "5": "开场" },
};

const base: AiConsoleViewInput = {
  mode: "rehearsal",
  nav: "control",
  devicesTab: "structure",
  controlTab: "manual",
  controlPanelVisible: true,
  sequencesTab: "selection",
  selectedObjectId: null,
  multiSelectedObjectIds: [],
  multiSelectedMotorIds: [],
  treeFocus: null,
  selectedSequenceId: null,
  names,
};

describe("resolveAiPage", () => {
  it("maps routes to pages", () => {
    expect(resolveAiPage("/login")).toEqual({ page: "login", ruleId: null });
    expect(resolveAiPage("/project-center")).toEqual({ page: "project-center", ruleId: null });
    expect(resolveAiPage("/console")).toEqual({ page: "console", ruleId: null });
    expect(resolveAiPage("/console/rule/r%201")).toEqual({ page: "rule-editor", ruleId: "r 1" });
    expect(resolveAiPage("/")).toEqual({ page: "other", ruleId: null });
  });
});

describe("buildAiConsoleView", () => {
  it("reports the tab of the active nav", () => {
    expect(buildAiConsoleView(base).tab).toBe("manual");
    expect(buildAiConsoleView({ ...base, nav: "devices", devicesTab: "debug" }).tab).toBe("debug");
    expect(buildAiConsoleView({ ...base, nav: "sequences", sequencesTab: "program" }).tab).toBe(
      "program",
    );
    expect(buildAiConsoleView({ ...base, controlPanelVisible: false }).tab).toBeNull();
  });

  it("matches show mode: control nav only and no manual tab", () => {
    const view = buildAiConsoleView({ ...base, mode: "show", nav: "devices" });
    expect(view.nav).toBe("control");
    expect(view.tab).toBe("log");
  });

  it("names the selected objects, motors, tree focus and timeline sequence", () => {
    const view = buildAiConsoleView({
      ...base,
      nav: "sequences",
      selectedObjectId: 21,
      multiSelectedObjectIds: [22],
      multiSelectedMotorIds: [12, 404],
      treeFocus: { kind: "master", id: 1 },
      selectedSequenceId: 5,
    });
    expect(view.selection).toEqual({
      objects: [
        { id: 21, name: "主幕" },
        { id: 22, name: "侧幕" },
      ],
      primaryObjectId: 21,
      motors: [
        { id: 12, name: "Hoist-C-2" },
        { id: 404, name: "404" },
      ],
      treeFocus: { kind: "master", id: 1, name: "主控PLC-01" },
      sequence: { id: 5, name: "开场" },
    });
  });

  it("does not duplicate the primary object already in the multi selection", () => {
    const view = buildAiConsoleView({ ...base, selectedObjectId: 21, multiSelectedObjectIds: [21, 22] });
    expect(view.selection.objects.map((item) => item.id)).toEqual([21, 22]);
  });
});
