import { describe, expect, it, vi } from "vitest";
import { createCloudKeyStore, type CloudKeyBackend, type CloudKeyStatus } from "./cloud-key-store";

function fakeBackend(initial: CloudKeyStatus): CloudKeyBackend & { saved: string[] } {
  const status = { ...initial };
  const saved: string[] = [];
  return {
    saved,
    status: vi.fn(async () => ({ ...status })),
    save: vi.fn(async (engine, value) => {
      saved.push(value);
      status[engine] = true;
    }),
    remove: vi.fn(async (engine) => {
      status[engine] = false;
    }),
  };
}

describe("cloud key store", () => {
  it("stays unknown outside the desktop app", async () => {
    const backend = fakeBackend({ azure: true, openai: true });
    const store = createCloudKeyStore(backend, () => false);
    await store.getState().refresh();
    expect(store.getState().status).toBeNull();
    expect(backend.status).not.toHaveBeenCalled();
  });

  it("reports the saved keys after a refresh", async () => {
    const store = createCloudKeyStore(fakeBackend({ azure: false, openai: true }), () => true);
    await store.getState().refresh();
    expect(store.getState().status).toEqual({ azure: false, openai: true });
  });

  it("updates every reader when a key is saved or removed", async () => {
    const backend = fakeBackend({ azure: false, openai: false });
    const store = createCloudKeyStore(backend, () => true);
    await store.getState().save("openai", "sk-test");
    expect(store.getState().status).toEqual({ azure: false, openai: true });
    await store.getState().remove("openai");
    expect(store.getState().status).toEqual({ azure: false, openai: false });
  });

  it("never keeps the key value in state", async () => {
    const store = createCloudKeyStore(fakeBackend({ azure: false, openai: false }), () => true);
    await store.getState().save("azure", "secret-value-123");
    expect(JSON.stringify(store.getState())).not.toContain("secret-value-123");
  });
});
