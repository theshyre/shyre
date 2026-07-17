/**
 * Fetch an image URL and inline it as a `data:` URI.
 *
 * The PDFs are rendered by @react-pdf/renderer both in the browser (download
 * button) and in Node (email bundle). Its `<Image src>` throws and fails the
 * WHOLE document if the src can't be loaded (CORS, 404, unsupported format) —
 * there's no per-image fallback. So we resolve the logo to a data URI up front:
 * on any failure we return null and the PDF falls back to the text wordmark,
 * never a broken render.
 *
 * @react-pdf's raster `<Image>` supports PNG and JPEG only. SVG/WebP logos are
 * intentionally dropped here (→ null → wordmark) even though they render fine
 * as a plain <img> on the sign page.
 */
const PDF_SAFE = new Set(["image/png", "image/jpeg", "image/jpg"]);

export async function fetchImageAsDataUri(
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (!PDF_SAFE.has(contentType)) return null;

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    // btoa in the browser; Buffer in Node — both reachable render paths.
    const base64 =
      typeof btoa !== "undefined"
        ? btoa(binary)
        : Buffer.from(buf).toString("base64");
    const normalized = contentType === "image/jpg" ? "image/jpeg" : contentType;
    return `data:${normalized};base64,${base64}`;
  } catch {
    return null;
  }
}
