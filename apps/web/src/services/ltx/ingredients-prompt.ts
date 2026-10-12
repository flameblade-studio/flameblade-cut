/**
 * Prompt for reference-to-video in the format the LTX-2.5 Ingredients
 * IC-LoRA was trained on (see its model card): a "Reference Sheet
 * Description" naming each panel by its position on the sheet, then a
 * "Target Description" of the one continuous shot to generate.
 *
 *   ### Reference Sheet Description
 *   **Top Row Left:** A young woman with long brown hair, white shirt ...
 *   **Top Row Right:** ...
 *   ### Target Description
 *   A cinematic medium shot of ...
 */
import type { ImageInput } from "./types";

/** Said for a panel the user did not describe. */
export const UNDESCRIBED_PANEL = "A reference element; keep its look exactly as shown.";

const SHEET_HEADING = "### Reference Sheet Description";
const TARGET_HEADING = "### Target Description";

/** True when the user already wrote the whole prompt in this format; it is then sent unchanged. */
export function isIngredientsPrompt(prompt: string): boolean {
  return prompt.includes(SHEET_HEADING) && prompt.includes(TARGET_HEADING);
}

/**
 * @param target     the shot to generate (the user's prompt, already in English when translated)
 * @param images     reference images in sheet order; `description` says what each one shows
 * @param positions  each image's position on the composed sheet, same order
 */
export function buildIngredientsPrompt(target: string, images: readonly ImageInput[], positions: readonly string[]): string {
  if (isIngredientsPrompt(target)) return target;
  if (positions.length !== images.length) {
    throw new Error(`Expected ${images.length} sheet positions, got ${positions.length}`);
  }
  const panels = images.map((image, index) => {
    const description = image.description?.trim() || UNDESCRIBED_PANEL;
    return `**${positions[index]}:** ${description}`;
  });
  return [SHEET_HEADING, ...panels, TARGET_HEADING, target.trim()].join("\n");
}
