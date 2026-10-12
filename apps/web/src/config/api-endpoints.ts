/**
 * Centralized API endpoint configuration.
 *
 * All external service URLs should be defined here so they can be
 * swapped for different environments or self-hosted instances.
 */

const isDev = import.meta.env.DEV;

/**
 * Cloud services (template sharing, video share links). Flameblade Cut is a
 * local-first app: nothing is uploaded unless a server of your own is set via
 * VITE_FLAMEBLADE_CLOUD_URL at build time. The upstream OpenReel build sent
 * these requests to api.openreel.video.
 */
const configuredCloudUrl = (import.meta.env.VITE_FLAMEBLADE_CLOUD_URL as string | undefined)?.trim() ?? "";
export const CLOUD_SERVICES_ENABLED = configuredCloudUrl !== "" || isDev;
export const OPENREEL_CLOUD_URL = configuredCloudUrl !== "" ? configuredCloudUrl : "http://localhost:8787";

export class CloudServicesDisabledError extends Error {
  constructor() {
    super("Cloud services are disabled in this build (no VITE_FLAMEBLADE_CLOUD_URL configured).");
    this.name = "CloudServicesDisabledError";
  }
}

/**
 * Third-party API base URLs.
 * These are used by the api-proxy service in dev mode (direct calls)
 * and by the Cloudflare Pages Function proxy in production.
 * Application code should use apiFetch() from services/api-proxy.ts
 * instead of importing these directly.
 */
