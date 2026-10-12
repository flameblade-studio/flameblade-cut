import { describe, expect, it } from "vitest";
import {
  LTX_TRANSFORMER_FILES as FILES,
  gpuNameFromSystemStats,
  modelErrorKind,
  modelErrorMessage,
  resolveTransformer,
  supportsNvfp4,
  unetNamesFromObjectInfo,
} from "./model-choice";

const RTX50 = "cuda:0 NVIDIA GeForce RTX 5060 Ti : cudaMallocAsync";
const RTX40 = "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync";
const ALL = [FILES.nvfp4, FILES.int8, FILES.bf16];

describe("supportsNvfp4", () => {
  it("accepts Blackwell GPUs only", () => {
    expect(supportsNvfp4(RTX50)).toBe(true);
    expect(supportsNvfp4("NVIDIA RTX PRO 6000 Blackwell Workstation Edition")).toBe(true);
    expect(supportsNvfp4(RTX40)).toBe(false);
    expect(supportsNvfp4("cuda:0 NVIDIA GeForce RTX 3060")).toBe(false);
  });
});

describe("resolveTransformer", () => {
  it("auto prefers NVFP4 on an RTX 50 card", () => {
    expect(resolveTransformer("auto", ALL, RTX50)).toMatchObject({ ok: true, transformer: "nvfp4" });
  });

  it("auto uses INT8 on an RTX 40 card even when NVFP4 is installed", () => {
    expect(resolveTransformer("auto", ALL, RTX40)).toMatchObject({ ok: true, transformer: "int8" });
  });

  it("auto falls back to BF16 when it is the only file", () => {
    expect(resolveTransformer("auto", [FILES.bf16], RTX40)).toMatchObject({ ok: true, transformer: "bf16" });
  });

  it("auto uses NVFP4 when the GPU is unknown", () => {
    expect(resolveTransformer("auto", [FILES.nvfp4], null)).toMatchObject({ ok: true, transformer: "nvfp4" });
  });

  it("auto explains when only NVFP4 is installed on a card that cannot run it", () => {
    expect(resolveTransformer("auto", [FILES.nvfp4], RTX40)).toEqual({ ok: false, reason: "nvfp4-unsupported", gpuName: RTX40 });
  });

  it("auto lists every accepted file when none is installed", () => {
    expect(resolveTransformer("auto", ["other.safetensors"], RTX50)).toEqual({ ok: false, reason: "missing", wanted: ALL });
  });

  it("an explicit choice must be installed", () => {
    expect(resolveTransformer("int8", [FILES.nvfp4], RTX50)).toEqual({ ok: false, reason: "missing", wanted: [FILES.int8] });
    expect(resolveTransformer("bf16", ALL, RTX50)).toMatchObject({ ok: true, transformer: "bf16", file: FILES.bf16 });
  });

  it("an explicit NVFP4 choice is refused on a card that cannot run it", () => {
    expect(resolveTransformer("nvfp4", ALL, RTX40)).toMatchObject({ ok: false, reason: "nvfp4-unsupported" });
  });
});

describe("model errors", () => {
  it("round-trips the error kind through the stored message", () => {
    expect(modelErrorKind(modelErrorMessage({ ok: false, reason: "missing", wanted: [FILES.int8] }))).toBe("missing");
    expect(modelErrorKind(modelErrorMessage({ ok: false, reason: "nvfp4-unsupported", gpuName: RTX40 }))).toBe("nvfp4-unsupported");
    expect(modelErrorKind("ComfyUI rejected the prompt")).toBeNull();
    expect(modelErrorKind(null)).toBeNull();
  });
});

describe("ComfyUI replies", () => {
  it("reads both combo shapes of UNETLoader", () => {
    expect(unetNamesFromObjectInfo({ UNETLoader: { input: { required: { unet_name: [["a.safetensors"], {}] } } } })).toEqual(["a.safetensors"]);
    expect(
      unetNamesFromObjectInfo({ UNETLoader: { input: { required: { unet_name: ["COMBO", { options: ["b.safetensors"] }] } } } }),
    ).toEqual(["b.safetensors"]);
    expect(unetNamesFromObjectInfo({})).toEqual([]);
  });

  it("reads the first GPU name", () => {
    expect(gpuNameFromSystemStats({ devices: [{ name: RTX50 }] })).toBe(RTX50);
    expect(gpuNameFromSystemStats({ devices: [] })).toBeNull();
    expect(gpuNameFromSystemStats(null)).toBeNull();
  });
});
