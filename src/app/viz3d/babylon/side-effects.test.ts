import { describe, expect, it } from "vitest";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import "../engine/Viz3DEngine";

describe("Babylon side effects", () => {
  it("registers the prototype extensions the engine relies on", () => {
    expect(typeof Engine.prototype.createDynamicTexture).toBe("function");
    expect(typeof Engine.prototype.updateDynamicTexture).toBe("function");
    expect(typeof Scene.prototype.pick).toBe("function");
    expect(typeof Scene.prototype.pickWithRay).toBe("function");
  });
});
