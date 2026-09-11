import { describe, expect, it, vi } from "vitest";
import {
  LIBRARY_ITEM_MIME,
  cueIdFromLibraryDrag,
  readLibraryDrag,
  sequenceProgramItemFromLibrary,
  writeLibraryDrag,
} from "./library-dnd";

const fakeTransfer = () => {
  const data = new Map<string, string>();
  const types: string[] = [];
  return {
    types,
    effectAllowed: "none" as string,
    dropEffect: "none" as string,
    setData: (type: string, value: string) => {
      data.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData: (type: string) => data.get(type) ?? "",
  };
};

describe("library-dnd", () => {
  it("round-trips a Cue payload and exposes its id for timeline drops", () => {
    const transfer = fakeTransfer();
    writeLibraryDrag(transfer as unknown as DataTransfer, { kind: "cue", id: "cue-1" });
    expect(transfer.effectAllowed).toBe("copy");
    expect(readLibraryDrag(transfer as unknown as DataTransfer)).toEqual({
      kind: "cue",
      id: "cue-1",
    });
    expect(cueIdFromLibraryDrag(transfer as unknown as DataTransfer)).toBe("cue-1");
  });

  it("does not treat a sequence library drag as a Cue drop", () => {
    const transfer = fakeTransfer();
    writeLibraryDrag(transfer as unknown as DataTransfer, { kind: "sequence", id: 1 });
    expect(cueIdFromLibraryDrag(transfer as unknown as DataTransfer)).toBeNull();
    expect(readLibraryDrag(transfer as unknown as DataTransfer)?.kind).toBe("sequence");
  });

  it("returns null when the mime type is empty", () => {
    const transfer = {
      types: [LIBRARY_ITEM_MIME],
      getData: vi.fn(() => ""),
    };
    expect(cueIdFromLibraryDrag(transfer as unknown as DataTransfer)).toBeNull();
  });

  it("maps sequence library drags to program items and ignores Cue", () => {
    expect(sequenceProgramItemFromLibrary({ kind: "cue", id: "cue-1" })).toBeNull();
    expect(sequenceProgramItemFromLibrary({ kind: "sequence", id: 12 })).toEqual({
      kind: "sequence",
      refId: 12,
    });
  });
});
