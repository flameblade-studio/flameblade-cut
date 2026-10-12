/**
 * Shot planner on the user's OpenAI key: one Structured Outputs call that
 * sees every reference image (downscaled) and returns the shot, a
 * description per image and an optional crop box.
 */
import { openAiInstructions, parseOpenAiPlan, SHOT_PLAN_JSON_SCHEMA } from "./instructions";
import { ShotPlanError, type ShotPlan, type ShotPlanInput, type ShotPlanner } from "./types";

/** The part of `window.openreel.openaiText` this planner uses. */
export interface VisionChatBridge {
  chat(args: {
    instructions: string;
    input: string;
    jsonSchema: { name: string; schema: Record<string, unknown> };
    maxOutputTokens?: number;
    reasoningEffort?: "low" | "medium" | "high";
    images?: { dataUrl: string; detail?: "low" | "high" | "auto" }[];
  }): Promise<{ text: string; model: string }>;
}

/** Encodes image bytes as a downscaled data URL for vision input. */
export type VisionImageEncoder = (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;

export function createOpenAiShotPlanner(bridge: VisionChatBridge, encode: VisionImageEncoder): ShotPlanner {
  return {
    async plan(input: ShotPlanInput, signal: AbortSignal): Promise<ShotPlan> {
      const images = [];
      for (const reference of input.references) {
        if (signal.aborted) throw new ShotPlanError("openai", "canceled");
        images.push({ dataUrl: await encode(reference.bytes), detail: "high" as const });
      }
      const notes = input.references
        .map((reference, index) => {
          const note = reference.image.description?.trim();
          return note ? `Image ${index + 1} (user's note): ${note}` : null;
        })
        .filter((line): line is string => line !== null);
      const request = [input.request.trim(), ...(notes.length > 0 ? ["", ...notes] : [])].join("\n");
      let text: string;
      try {
        ({ text } = await bridge.chat({
          instructions: openAiInstructions(input.mode, input.durationSec, input.references.length),
          input: request,
          jsonSchema: { name: "shot_plan", schema: SHOT_PLAN_JSON_SCHEMA as unknown as Record<string, unknown> },
          maxOutputTokens: 4000,
          reasoningEffort: "low",
          ...(images.length > 0 ? { images } : {}),
        }));
      } catch (error) {
        throw new ShotPlanError("openai", error instanceof Error ? error.message : String(error));
      }
      try {
        return parseOpenAiPlan(text, input.references.length);
      } catch (error) {
        throw new ShotPlanError("openai", error instanceof Error ? error.message : String(error));
      }
    },
  };
}
