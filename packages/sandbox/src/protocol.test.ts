import { describe, expect, it } from "vitest";
import { encodeFrame, frameReader } from "./protocol";

describe("frameReader", () => {
  it("keeps multi-byte characters whole when a chunk boundary splits them", () => {
    const frames: unknown[] = [];

    const read = frameReader(
      (f) => frames.push(f),
      (e) => frames.push(e),
    );

    const bytes = Buffer.from(encodeFrame({ t: "done", result: { name: "José 東京" } } as never));

    for (let i = 0; i < bytes.length; i += 3) read(bytes.subarray(i, i + 3));

    expect(frames).toEqual([{ t: "done", result: { name: "José 東京" } }]);
  });
});
