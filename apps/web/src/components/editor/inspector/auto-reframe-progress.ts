/**
 * Auto-reframe progress in the UI language. Core reports each step with an
 * English message and a stable stage code (`AutoReframeProgressDetail`);
 * this maps the code to an i18n key and keeps core's English text as the
 * fallback for any stage without a translation.
 */
import type { AutoReframeProgressDetail, AutoReframeProgressStage } from "@openreel/core";
import { serviceMessage, type ServiceMessage } from "../../../services/service-message";

const STAGE_KEYS: Record<AutoReframeProgressStage, string> = {
  initializing: "initializing",
  ready: "ready",
  analyzing: "analyzing",
  "analyzing-frame": "analyzingFrame",
  "analysis-complete": "analysisComplete",
};

export function autoReframeStageKey(stage: AutoReframeProgressStage): string {
  return `tools.serviceMessages.autoReframe.stages.${STAGE_KEYS[stage]}`;
}

export function autoReframeProgressMessage(
  message: string,
  detail: AutoReframeProgressDetail | undefined,
): ServiceMessage | string {
  if (detail === undefined) return message;
  const params =
    detail.stage === "analyzing-frame"
      ? { frame: detail.frame ?? 0, frameCount: detail.frameCount ?? 0 }
      : undefined;
  return serviceMessage(autoReframeStageKey(detail.stage), message, params);
}
