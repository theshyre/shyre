import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchImageAsDataUri } from "./image-data-uri";

function mockFetch(res: Partial<Response> & { _body?: Uint8Array }): void {
  const body = res._body ?? new Uint8Array([1, 2, 3]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: res.ok ?? true,
      headers: { get: () => (res.headers as unknown as string) ?? "image/png" },
      arrayBuffer: async () => body.buffer,
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchImageAsDataUri", () => {
  it("returns null for a null/empty url without fetching", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await fetchImageAsDataUri(null)).toBeNull();
    expect(await fetchImageAsDataUri("")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("inlines a PNG as a base64 data URI", async () => {
    mockFetch({ headers: "image/png" as unknown as Headers });
    const uri = await fetchImageAsDataUri("https://x/logo.png");
    expect(uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
  });

  it("normalizes image/jpg → image/jpeg", async () => {
    mockFetch({ headers: "image/jpg" as unknown as Headers });
    const uri = await fetchImageAsDataUri("https://x/logo.jpg");
    expect(uri?.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("drops SVG/WebP (not PDF-safe) → null so the PDF falls back to the wordmark", async () => {
    mockFetch({ headers: "image/svg+xml" as unknown as Headers });
    expect(await fetchImageAsDataUri("https://x/logo.svg")).toBeNull();
    mockFetch({ headers: "image/webp" as unknown as Headers });
    expect(await fetchImageAsDataUri("https://x/logo.webp")).toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    mockFetch({ ok: false });
    expect(await fetchImageAsDataUri("https://x/missing.png")).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await fetchImageAsDataUri("https://x/logo.png")).toBeNull();
  });
});
