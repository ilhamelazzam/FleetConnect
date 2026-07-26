import { afterEach, describe, expect, it, vi } from "vitest";

import { createUuid } from "../uuid";

const nativeCrypto = globalThis.crypto;

describe("createUuid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses randomUUID when the runtime provides it", () => {
    const randomUUID = vi.fn(() => "native-uuid");

    vi.stubGlobal("crypto", {
      randomUUID,
    });

    expect(createUuid()).toBe("native-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => nativeCrypto.getRandomValues(bytes));

    vi.stubGlobal("crypto", {
      getRandomValues,
    });

    const value = createUuid();

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
