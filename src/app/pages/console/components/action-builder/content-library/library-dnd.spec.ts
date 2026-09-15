import { describe, expect, it, vi } from "vitest";
import {
  LIBRARY_ITEM_MIME,
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
  it("round-trips a sequence payload and ignores Cue-shaped json", () => {
    const transfer = fakeTransfer();
    writeLibraryDrag(transfer as unknown as DataTransfer, { kind: "sequence", id: 12 });
    expect(readLibraryDrag(transfer as unknown as DataTransfer)).toEqual({
      kind: "sequence",
      id: 12,
    });
    expect(
      sequenceProgramItemFromLibrary({ kind: "sequence", id: 12 }),
    ).toEqual({ kind: "sequence", refId: 12 });
    transfer.setData(LIBRARY_ITEM_MIME, JSON.stringify({ kind: "cue", id: "cue-1" }));
    expect(readLibraryDrag(transfer as unknown as DataTransfer)).toBeNull();
  });

  it("returns null when the mime type is empty", () => {
    const transfer = {
      types: [LIBRARY_ITEM_MIME],
      getData: vi.fn(() => ""),
    };
    expect(readLibraryDrag(transfer as unknown as DataTransfer)).toBeNull();
  });
});
