/**
 * Messages that background services hand to the UI. A service records an
 * i18n key, its interpolation params, and a plain English fallback; the
 * component translates at display time so the text follows the UI language
 * (and switches with it). Producers that only have raw text (third-party
 * errors, legacy callers) pass a plain string, which is shown unchanged.
 */
import type { TFunction } from "i18next";

export type ServiceMessageParams = Readonly<Record<string, string | number>>;

export interface ServiceMessage {
  /** Full i18n key, e.g. `tools.serviceMessages.processing.waiting`. */
  readonly key: string;
  readonly params?: ServiceMessageParams;
  /** Shown when the key is missing; also the plain-text form for logs. */
  readonly fallback: string;
}

export function serviceMessage(key: string, fallback: string, params?: ServiceMessageParams): ServiceMessage {
  return params === undefined ? { key, fallback } : { key, fallback, params };
}

/** Plain-text form of a message (its English fallback, or the raw string). */
export function serviceMessageText(message: ServiceMessage | string): string {
  return typeof message === "string" ? message : message.fallback;
}

/**
 * An error whose user-facing text is keyed. `message` stays the English
 * fallback so logs and existing `err.message` readers keep working.
 */
export class ServiceMessageError extends Error {
  readonly serviceMessage: ServiceMessage;

  constructor(message: ServiceMessage) {
    super(message.fallback);
    this.name = "ServiceMessageError";
    this.serviceMessage = message;
  }
}

/** Keyed form of a caught error, its raw message, or `fallback` for non-errors. */
export function errorServiceMessage(error: unknown, fallback: ServiceMessage): ServiceMessage | string {
  if (error instanceof ServiceMessageError) return error.serviceMessage;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Text of a message in the UI language; raw strings pass through unchanged. */
export function translateServiceMessage(t: TFunction, message: ServiceMessage | string | undefined): string {
  if (message === undefined) return "";
  if (typeof message === "string") return message;
  return t(message.key, { ...message.params, defaultValue: message.fallback });
}
