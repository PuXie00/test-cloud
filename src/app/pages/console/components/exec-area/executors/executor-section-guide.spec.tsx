// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ConsoleModeProvider, useConsoleMode } from "../../../hooks/use-console-mode";
import { ExecutorSectionGuide } from "./executor-section-guide";

afterEach(() => {
  cleanup();
});

const withMode = (children: ReactNode) => createElement(ConsoleModeProvider, null, children);

const ShowMode = ({ children }: { children: ReactNode }) => {
  const { enterShow } = useConsoleMode();
  useEffect(() => {
    enterShow();
  }, [enterShow]);
  return children;
};

describe("ExecutorSectionGuide", () => {
  it("keeps a short rehearsal line and drops the old tutorial copy", () => {
    render(withMode(<ExecutorSectionGuide />));
    expect(screen.getByText("推子槽")).toBeTruthy();
    expect(screen.getByText("拖入序列")).toBeTruthy();
    expect(screen.queryByText("动作序列")).toBeNull();
    expect(screen.queryByText("默认 100%")).toBeNull();
    expect(screen.queryByText("排练可拖放编排")).toBeNull();
  });

  it("uses a short show-mode line", async () => {
    render(withMode(<ShowMode><ExecutorSectionGuide /></ShowMode>));
    expect(await screen.findByText("推子调速")).toBeTruthy();
    expect(screen.queryByText("演出模式只执行")).toBeNull();
  });
});
