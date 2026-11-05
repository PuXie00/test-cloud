import { describe, expect, it } from "vitest";
import type { ControlledObject } from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import { MOTION_DEFAULTS } from "./configuration-rules";
import { encodeControlType } from "./control-type-code";
import { createEmptyDocument } from "./project-document-empty";
import { assertProjectDocumentStructure } from "./project-document-assert";
import type { ControlledObjectConfig } from "./project-document-types";
import { controlledObjectConfigToWizard } from "./setup-adapters";
import { wizardControlledObjectToConfig } from "./setup-persist";

const hoist = (overrides: Partial<ControlledObject> = {}): ControlledObject => ({
  id: 1,
  name: "多级升降-01",
  controlType: "multiLevelHoist",
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  motionParams: { h: { ...MOTION_DEFAULTS.move } },
  maxAxisVelocity: 200,
  pulleyDistance: 0,
  modelRunDirection: 1,
  multiLevel: { adjustDistances: [300, 100], decelerationRatio: 70 },
  axes: [{ key: "0", custom: false, mount: { x: 0, z: 0 } }],
  params: {},
  ...overrides,
});

const documentWith = (object: ControlledObjectConfig) => {
  const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
  document.setup.controlledObjects = [object];
  return document;
};

describe("multi-level config in the project file", () => {
  it("saves sorted and loads back", () => {
    const config = wizardControlledObjectToConfig(hoist());
    expect(config.multiLevel).toEqual({ adjustDistances: [100, 300], decelerationRatio: 70 });
    expect(controlledObjectConfigToWizard(config).multiLevel).toEqual(config.multiLevel);
  });

  it("fills the default for a multi-level hoist saved without it", () => {
    const config = wizardControlledObjectToConfig(hoist({ multiLevel: undefined }));
    expect(config.multiLevel).toEqual({ adjustDistances: [], decelerationRatio: 50 });
  });

  it("validates it only on multi-level hoists", () => {
    const valid = wizardControlledObjectToConfig(hoist());
    expect(() => assertProjectDocumentStructure(documentWith(valid))).not.toThrow();

    const unsorted = { ...valid, multiLevel: { adjustDistances: [300, 100], decelerationRatio: 50 } };
    expect(() => assertProjectDocumentStructure(documentWith(unsorted))).toThrow(/strictly increasing/);

    const ratio = { ...valid, multiLevel: { adjustDistances: [], decelerationRatio: 120 } };
    expect(() => assertProjectDocumentStructure(documentWith(ratio))).toThrow(/decelerationRatio/);

    const other = {
      ...valid,
      controlType: encodeControlType("singlePointMove"),
    };
    expect(() => assertProjectDocumentStructure(documentWith(other))).toThrow(/only for multi-level hoist/);
  });
});
