import { useEffect } from "react";
import { useGoReady } from "../hooks/go-ready-provider";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DGoShadowSync = () => {
  const engine = useViz3DContext();
  const { state } = useGoReady();

  useEffect(() => {
    if (state.phase === "idle") {
      engine.clearGoShadows();
      return;
    }
    engine.setGoShadows(
      state.entries.map((entry) => ({ objectId: entry.objectId, target: entry.target })),
    );
  }, [engine, state.phase, state.entries]);

  useEffect(() => () => engine.clearGoShadows(), [engine]);

  return null;
};
