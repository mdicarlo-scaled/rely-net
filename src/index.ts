// Core client
export { RelyClient } from "./client";
export { RelyClient as Rely } from "./client"; // convenience alias

// Next.js middleware
export { withRelyMiddleware } from "./middleware";

// Types customers may need
export type {
  RelyClientOptions,
  HealthCheckFn,
  HealthCheckResult,
  DeploymentInfo,
  MetricDatapoint,
  IngestPayload,
  IngestResponse,
  RequestWindowData,
  RouteStats,
  RuntimeStats,
  Environment,
} from "./types";

// Version constant
export { SDK_VERSION } from "./types";

// Module-level singleton pattern
// Allows customers to initialize once and import anywhere

import { RelyClient } from "./client";
import type { RelyClientOptions } from "./types";

let _instance: RelyClient | null = null;

export function createRelyClient(options: RelyClientOptions): RelyClient {
  _instance = new RelyClient(options);
  return _instance;
}

export function getRelyClient(): RelyClient {
  if (!_instance) {
    throw new Error(
      "[Rely] SDK not initialized.\n" +
        "Call createRelyClient() in your instrumentation.ts file first.\n" +
        "See https://rely.net/docs/sdk for setup instructions."
    );
  }
  return _instance;
}
