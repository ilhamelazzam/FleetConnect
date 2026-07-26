function formatUuidFromBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function createUuid(): string {
  const runtimeCrypto = globalThis.crypto;

  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  if (typeof runtimeCrypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    runtimeCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return formatUuidFromBytes(bytes);
  }

  const seed = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    .padEnd(32, "0")
    .slice(0, 32);
  return [
    seed.slice(0, 8),
    seed.slice(8, 12),
    `4${seed.slice(13, 16)}`,
    `8${seed.slice(17, 20)}`,
    seed.slice(20, 32),
  ].join("-");
}
