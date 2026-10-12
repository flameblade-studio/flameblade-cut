import { afterEach, describe, expect, it } from "vitest";
import { i18next } from "../i18n";
import { RESOURCE_LANGUAGES, stringsFor } from "../i18n/resources";
import {
  errorServiceMessage,
  serviceMessage,
  ServiceMessageError,
  translateServiceMessage,
} from "./service-message";
import { useProcessingStore } from "./processing-manager";

function lookup(strings: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], strings);
}

describe("service messages", () => {
  const initial = i18next.language;
  afterEach(async () => {
    await i18next.changeLanguage(initial);
  });

  it("passes raw strings through and falls back for unknown keys", async () => {
    await i18next.changeLanguage("zh-TW");
    expect(translateServiceMessage(i18next.t, "Raw provider text")).toBe("Raw provider text");
    expect(translateServiceMessage(i18next.t, undefined)).toBe("");
    expect(translateServiceMessage(i18next.t, serviceMessage("tools.serviceMessages.nope", "English fallback"))).toBe(
      "English fallback",
    );
  });

  it("unwraps keyed errors, keeps raw error text, and uses the fallback otherwise", () => {
    const keyed = serviceMessage("tools.serviceMessages.processing.failed", "Failed");
    const fallback = serviceMessage("inspector.common.unknownError", "Unknown error");
    const error = new ServiceMessageError(keyed);
    expect(error.message).toBe("Failed");
    expect(errorServiceMessage(error, fallback)).toBe(keyed);
    expect(errorServiceMessage(new Error("boom"), fallback)).toBe("boom");
    expect(errorServiceMessage(42, fallback)).toBe(fallback);
  });
});

describe("processing tasks", () => {
  const initial = i18next.language;
  afterEach(async () => {
    await i18next.changeLanguage(initial);
    useProcessingStore.setState({ tasks: new Map(), isProcessing: false, currentTaskId: null });
  });

  it("stores keyed progress and errors with an English plain-text fallback", async () => {
    const store = useProcessingStore.getState();
    const id = store.addTask("clip-1", "background-removal");
    const queued = useProcessingStore.getState().tasks.get(id);
    expect(queued?.message).toBe("Waiting to start...");

    store.updateTaskProgress(id, 30, serviceMessage("inspector.bgRemoval.preparing", "Preparing background detection..."));
    const running = useProcessingStore.getState().tasks.get(id);
    expect(running?.message).toBe("Preparing background detection...");
    await i18next.changeLanguage("zh-TW");
    expect(translateServiceMessage(i18next.t, running?.localizedMessage ?? running?.message)).toBe(
      lookup(stringsFor("zh-TW"), "inspector.bgRemoval.preparing"),
    );

    store.updateTaskProgress(id, 40, "raw progress");
    const raw = useProcessingStore.getState().tasks.get(id);
    expect(raw?.message).toBe("raw progress");
    expect(raw?.localizedMessage).toBeUndefined();

    store.failTask(id, "engine exploded");
    const failed = useProcessingStore.getState().tasks.get(id);
    expect(failed?.error).toBe("engine exploded");
    expect(failed?.localizedError).toBeUndefined();
    expect(failed?.message).toBe("Failed");
  });

  it.each(RESOURCE_LANGUAGES)("%s defines the processing default messages", (language) => {
    for (const key of ["waiting", "complete", "failed"]) {
      expect(typeof lookup(stringsFor(language), `tools.serviceMessages.processing.${key}`)).toBe("string");
    }
  });
});
