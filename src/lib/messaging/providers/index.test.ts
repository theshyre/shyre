import { describe, it, expect, vi } from "vitest";

const resendSenderMock = vi.fn();
vi.mock("./resend", () => ({
  resendSender: (key: string) => resendSenderMock(key),
}));

import { senderFor } from "./index";

describe("senderFor", () => {
  it("returns the Resend driver for provider='resend'", () => {
    resendSenderMock.mockReturnValueOnce({ kind: "resend-driver" });
    const sender = senderFor("resend", "test-key");
    expect(sender).toEqual({ kind: "resend-driver" });
    expect(resendSenderMock).toHaveBeenCalledWith("test-key");
  });

  it("forwards a different api key to the driver factory", () => {
    resendSenderMock.mockReturnValueOnce({ kind: "resend-driver" });
    senderFor("resend", "different-key");
    expect(resendSenderMock).toHaveBeenLastCalledWith("different-key");
  });

  it("throws on an unsupported provider id (defensive — the exhaustive switch)", () => {
    expect(() =>
      // @ts-expect-error — intentionally pass an off-vocab id to hit
      // the `default` branch + `never` exhaustive check.
      senderFor("postmark", "k"),
    ).toThrow(/Unsupported provider/);
  });
});
