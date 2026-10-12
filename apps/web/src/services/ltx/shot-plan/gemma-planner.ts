/**
 * Shot planner on LTX's bundled Gemma helper model, run as ComfyUI jobs
 * (core `TextGenerate` + `PreviewAny` nodes): first one look per reference
 * image (each at full size, so small design-sheet details survive), then one
 * text-only call that writes the shot. Free and fully local; it does not
 * crop (the small model's boxes are not reliable).
 */
import type { ComfyApiPrompt } from "../workflow-binder";
import type { ComfyFileRef } from "../types";
import { cleanSentence, PANEL_SYSTEM_PROMPT, panelUserPrompt, shotSystemPrompt, shotUserPrompt } from "./instructions";
import { ShotPlanError, type ShotPlan, type ShotPlanInput, type ShotPlanner } from "./types";

/** Gemma 4 E2B text-generation weights shipped for the LTX-2.5 prompt enhancer. */
export const GEMMA_PLANNER_MODEL = "gemma4_e2b_it_int8_convrot.safetensors";

const PANEL_MAX_TOKENS = 120;
const SHOT_MAX_TOKENS = 400;

/** What the planner needs from the generation runner (which owns the ComfyUI connection). */
export interface ComfyTextJobs {
  /** Uploads one reference image to ComfyUI's input folder. */
  uploadImage(bytes: Uint8Array<ArrayBuffer>, filename: string): Promise<ComfyFileRef>;
  /** Queues `prompt`, waits for it, and returns each `PreviewAny` node's text by node id. */
  runTextJob(prompt: ComfyApiPrompt, signal: AbortSignal): Promise<Record<string, string>>;
}

function loaderNode(): ComfyApiPrompt[string] {
  return {
    class_type: "CLIPLoader",
    inputs: { clip_name: GEMMA_PLANNER_MODEL, type: "ltxv", device: "default" },
    _meta: { title: "Planner model" },
  };
}

function generateNode(prompt: string, system: string, maxTokens: number, image: [string, number] | null): ComfyApiPrompt[string] {
  return {
    class_type: "TextGenerate",
    inputs: {
      clip: ["plan.model", 0],
      prompt,
      system_prompt: system,
      max_length: maxTokens,
      // Greedy decoding: the same request gives the same plan.
      sampling_mode: "off",
      thinking: false,
      use_default_template: true,
      mtp: "auto",
      ...(image === null ? {} : { image }),
    },
  };
}

/** One job describing every reference image; node ids `plan.text.<i>`. */
export function buildPanelGraph(files: readonly ComfyFileRef[], notes: readonly (string | undefined)[]): ComfyApiPrompt {
  const graph: ComfyApiPrompt = { "plan.model": loaderNode() };
  files.forEach((file, index) => {
    const name = file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename;
    graph[`plan.image.${index}`] = { class_type: "LoadImage", inputs: { image: name } };
    graph[`plan.describe.${index}`] = generateNode(panelUserPrompt(notes[index]), PANEL_SYSTEM_PROMPT, PANEL_MAX_TOKENS, [
      `plan.image.${index}`,
      0,
    ]);
    graph[`plan.text.${index}`] = { class_type: "PreviewAny", inputs: { source: [`plan.describe.${index}`, 0] } };
  });
  return graph;
}

/** One text-only job writing the shot; node id `plan.text.shot`. */
export function buildShotGraph(input: ShotPlanInput, panels: readonly string[]): ComfyApiPrompt {
  return {
    "plan.model": loaderNode(),
    "plan.write": generateNode(shotUserPrompt(input.mode, input.request, panels), shotSystemPrompt(input.durationSec), SHOT_MAX_TOKENS, null),
    "plan.text.shot": { class_type: "PreviewAny", inputs: { source: ["plan.write", 0] } },
  };
}

export function createGemmaShotPlanner(jobs: ComfyTextJobs, filePrefix: string): ShotPlanner {
  return {
    async plan(input: ShotPlanInput, signal: AbortSignal): Promise<ShotPlan> {
      const panels: string[] = [];
      if (input.references.length > 0) {
        const files: ComfyFileRef[] = [];
        for (const [index, reference] of input.references.entries()) {
          files.push(await jobs.uploadImage(reference.bytes, `${filePrefix}-ref-${index + 1}.png`));
        }
        const texts = await jobs.runTextJob(
          buildPanelGraph(
            files,
            input.references.map((reference) => reference.image.description),
          ),
          signal,
        );
        input.references.forEach((_, index) => panels.push(cleanSentence(texts[`plan.text.${index}`] ?? "")));
        if (panels.some((panel) => panel === "")) throw new ShotPlanError("local", "a reference image came back without a description");
      }
      const shotTexts = await jobs.runTextJob(buildShotGraph(input, panels), signal);
      const shot = cleanSentence(shotTexts["plan.text.shot"] ?? "");
      if (shot === "") throw new ShotPlanError("local", "the shot came back empty");
      return { shot, panels: panels.map((description) => ({ description, crop: null })) };
    },
  };
}
