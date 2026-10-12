import { describe, expect, it } from "vitest";
import { findVideoOutput, HistoryParseError, parseHistory, parseWsMessage } from "./history-parser";
import { parseQueuePromptResponse, parseQueueState, ComfyPromptRejectedError } from "./queue-parser";
import { successHistoryEntry } from "./fake-comfy-transport";

const ID = "20d37bce-30c6-4a66-8229-ed0a1e3d7a3a";

describe("parseHistory", () => {
  it("treats an empty object as pending", () => {
    expect(parseHistory({}, ID)).toEqual({ kind: "pending" });
  });

  it("finds the SaveVideo mp4 in the real ComfyUI 0.38 shape (under `images`)", () => {
    const body = { [ID]: successHistoryEntry(ID, "rec-1_00001_.mp4") };
    expect(parseHistory(body, ID)).toEqual({
      kind: "success",
      video: { filename: "rec-1_00001_.mp4", subfolder: "flameblade-cut", type: "output" },
    });
  });

  it.each(["videos", "gifs"])("also finds video files under `%s`", (key) => {
    const outputs = {
      "9": { images: [{ filename: "poster.png", subfolder: "", type: "output" }] },
      "75": { [key]: [{ filename: "clip.WEBM", subfolder: "x", type: "output" }] },
    };
    expect(findVideoOutput(outputs)).toEqual({ filename: "clip.WEBM", subfolder: "x", type: "output" });
  });

  it("reports an execution error with node type", () => {
    const body = {
      [ID]: {
        outputs: {},
        status: {
          status_str: "error",
          completed: false,
          messages: [
            ["execution_start", { prompt_id: ID, timestamp: 1 }],
            [
              "execution_error",
              {
                prompt_id: ID,
                node_id: "405:344",
                node_type: "SamplerCustomAdvanced",
                executed: [],
                exception_message: "Allocation on device \n",
                exception_type: "torch.OutOfMemoryError",
                traceback: [],
                current_inputs: {},
                current_outputs: {},
                timestamp: 2,
              },
            ],
          ],
        },
      },
    };
    expect(parseHistory(body, ID)).toEqual({
      kind: "error",
      message: "SamplerCustomAdvanced: Allocation on device",
    });
  });

  it("reports interruption", () => {
    const body = {
      [ID]: {
        outputs: {},
        status: {
          status_str: "error",
          completed: false,
          messages: [["execution_interrupted", { prompt_id: ID, node_id: "405:344", node_type: "X", executed: [] }]],
        },
      },
    };
    expect(parseHistory(body, ID)).toEqual({ kind: "interrupted" });
  });

  it("fails a completed job without a video file", () => {
    const body = { [ID]: { outputs: { "405:381": { text: ["x"] } }, status: { status_str: "success", completed: true, messages: [] } } };
    expect(parseHistory(body, ID)).toMatchObject({ kind: "error" });
  });

  it("throws on a non-object body", () => {
    expect(() => parseHistory([], ID)).toThrow(HistoryParseError);
  });
});

describe("parseWsMessage", () => {
  const frame = (type: string, data: unknown) => JSON.stringify({ type, data });

  it("parses the real message shapes", () => {
    expect(parseWsMessage(frame("status", { status: { exec_info: { queue_remaining: 2 } }, sid: "c" }))).toEqual({
      type: "status",
      queueRemaining: 2,
    });
    expect(parseWsMessage(frame("execution_start", { prompt_id: ID, timestamp: 1 }))).toEqual({
      type: "execution_start",
      promptId: ID,
    });
    expect(parseWsMessage(frame("executing", { node: "405:383", display_node: "405:383", prompt_id: ID }))).toEqual({
      type: "executing",
      promptId: ID,
      node: "405:383",
    });
    expect(parseWsMessage(frame("executing", { node: null, prompt_id: ID }))).toEqual({
      type: "executing",
      promptId: ID,
      node: null,
    });
    expect(parseWsMessage(frame("progress", { value: 1, max: 8, prompt_id: ID, node: "405:344" }))).toEqual({
      type: "progress",
      promptId: ID,
      node: "405:344",
      value: 1,
      max: 8,
    });
    expect(parseWsMessage(frame("execution_success", { prompt_id: ID, timestamp: 1 }))).toEqual({
      type: "execution_success",
      promptId: ID,
    });
    expect(
      parseWsMessage(frame("execution_error", { prompt_id: ID, node_type: "VAELoader", exception_message: "missing file" })),
    ).toEqual({ type: "execution_error", promptId: ID, message: "VAELoader: missing file", nodeType: "VAELoader" });
    expect(parseWsMessage(frame("execution_interrupted", { prompt_id: ID }))).toEqual({
      type: "execution_interrupted",
      promptId: ID,
    });
  });

  it("ignores unknown, malformed and non-JSON frames", () => {
    expect(parseWsMessage(frame("progress_state", { prompt_id: ID, nodes: {} }))).toBeNull();
    expect(parseWsMessage(frame("executed", { node: "75", output: {}, prompt_id: ID }))).toBeNull();
    expect(parseWsMessage(frame("progress", { value: "1" }))).toBeNull();
    expect(parseWsMessage("not json")).toBeNull();
    expect(parseWsMessage(JSON.stringify({ type: "status" }))).toBeNull();
  });
});

describe("queue parsers", () => {
  it("returns the prompt id from a successful /prompt", () => {
    expect(parseQueuePromptResponse(200, JSON.stringify({ prompt_id: ID, number: 0, node_errors: {} }))).toBe(ID);
  });

  it("explains node_errors from a rejected /prompt", () => {
    const body = {
      error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation", details: "", extra_info: {} },
      node_errors: {
        "405:384": {
          errors: [{ type: "value_not_in_list", message: "Value not in list", details: "unet_name: 'x.safetensors' not in []", extra_info: {} }],
          dependent_outputs: ["75"],
          class_type: "UNETLoader",
        },
      },
    };
    expect(() => parseQueuePromptResponse(400, JSON.stringify(body))).toThrow(ComfyPromptRejectedError);
    expect(() => parseQueuePromptResponse(400, JSON.stringify(body))).toThrow(
      "Prompt outputs failed validation\nUNETLoader: Value not in list: unet_name: 'x.safetensors' not in []",
    );
  });

  it("explains non-JSON HTTP errors", () => {
    expect(() => parseQueuePromptResponse(500, "Internal Server Error")).toThrow(
      "ComfyUI rejected the job (HTTP 500)\nInternal Server Error",
    );
  });

  it("parses /queue running and pending ids", () => {
    const body = { queue_running: [[0, "a", {}, {}, []]], queue_pending: [[1, "b", {}, {}, []], [2, "c"]] };
    expect(parseQueueState(JSON.stringify(body))).toEqual({ running: ["a"], pending: ["b", "c"] });
  });
});
