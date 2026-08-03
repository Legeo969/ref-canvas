import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileProtocolResponse, parseByteRange } from "./protocol-file-response";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("parseByteRange", () => {
  it("supports bounded, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=2-5", 10)).toEqual({ status: "valid", start: 2, end: 5 });
    expect(parseByteRange("bytes=7-", 10)).toEqual({ status: "valid", start: 7, end: 9 });
    expect(parseByteRange("bytes=-3", 10)).toEqual({ status: "valid", start: 7, end: 9 });
  });

  it("rejects multiple and out-of-bounds ranges", () => {
    expect(parseByteRange("bytes=0-1,4-5", 10)).toEqual({ status: "invalid" });
    expect(parseByteRange("bytes=10-", 10)).toEqual({ status: "invalid" });
  });
});

describe("fileProtocolResponse", () => {
  it("returns seekable GET and HEAD responses", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-range-"));
    directories.push(directory);
    const filename = path.join(directory, "sample.mp4");
    await writeFile(filename, Buffer.from("0123456789"));

    const partial = await fileProtocolResponse(filename, {
      method: "GET",
      headers: new Headers({ Range: "bytes=3-6" }),
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 3-6/10");
    expect(partial.headers.get("accept-ranges")).toBe("bytes");
    expect(await partial.text()).toBe("3456");

    const head = await fileProtocolResponse(filename, {
      method: "HEAD",
      headers: new Headers(),
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
  });

  it("returns 416 with the complete size", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-range-"));
    directories.push(directory);
    const filename = path.join(directory, "sample.mov");
    await writeFile(filename, Buffer.from("1234"));
    const response = await fileProtocolResponse(filename, {
      method: "GET",
      headers: new Headers({ Range: "bytes=9-" }),
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */4");
  });
});
