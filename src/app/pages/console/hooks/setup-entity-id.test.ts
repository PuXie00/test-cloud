import { describe, expect, it } from "vitest";
import {
  SETUP_ENTITY_ID_MIN,
  allocateSetupEntityIds,
  isValidSetupEntityId,
} from "./setup-entity-id";

describe("allocateSetupEntityIds", () => {
  it("starts from 1 in an empty project", () => {
    expect(SETUP_ENTITY_ID_MIN).toBe(1);
    expect(allocateSetupEntityIds([], 1)).toEqual([1]);
    expect(allocateSetupEntityIds([], 3)).toEqual([1, 2, 3]);
  });

  it("continues after the current max and skips 0", () => {
    expect(allocateSetupEntityIds([1, 2], 1)).toEqual([3]);
    expect(isValidSetupEntityId(0)).toBe(false);
    expect(isValidSetupEntityId(1)).toBe(true);
  });
});
