import { describe, expect, it } from "vitest";
import { delIfValue, getJson, setJsonIfNotExists } from "./kv";

describe("order lock ownership", () => {
  it("PR2-CONC-LOCK-01 only the lock owner can release a key", async () => {
    const key = `test:order-lock:${Date.now()}:owner`;
    await expect(setJsonIfNotExists(key, "owner-a", 60)).resolves.toBe(true);

    await expect(delIfValue(key, "owner-b")).resolves.toBe(false);
    await expect(getJson(key)).resolves.toBe("owner-a");
    await expect(setJsonIfNotExists(key, "owner-b", 60)).resolves.toBe(false);

    await expect(delIfValue(key, "owner-a")).resolves.toBe(true);
    await expect(getJson(key)).resolves.toBeNull();
  });

  it("PR2-CONC-LOCK-02 releasing an expired or missing lock is a safe no-op", async () => {
    const key = `test:order-lock:${Date.now()}:missing`;
    await expect(delIfValue(key, "owner-a")).resolves.toBe(false);
    await expect(getJson(key)).resolves.toBeNull();
  });
});
