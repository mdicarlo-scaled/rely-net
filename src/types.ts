export const SDK_VERSION = "1.0.0";

export type Environment = "production" | "staging" | "development";

export type HealthCheckStatus = "passing" | "failing";

// Function the customer provides to perform a health check.
// Should throw an error if the check fails.
// Should resolve normally if the check passes.
export type HealthCheckFn = () => Promise<void>;

export interface HealthCheckResult {
  name: string;
  status: HealthCheckStatus;
  duration_ms: number;
  error_message?: string; // sanitized before sending
  stack_trace?: string; // sanitized before sending
}

export interface DeploymentInfo {
  version?: string; // git SHA or semver
  environment?: string;
  branch?: string;
  commit_message?: string;
  metadata?: Record<string, string>;
}

export interface MetricDatapoint {
  name: string;
  value: number;
  tags?: Record<string, string>;
  unit?: string;
}

export interface RuntimeStats {
  memory_heap_used_mb: number;
  memory_heap_total_mb: number;
  memory_rss_mb: number;
  cpu_usage_percent: number;
  process_uptime_secs: number;
  node_version: string;
  region: string;
}

export interface RouteStats {
  route: string;
  p95_ms: number;
  count: number;
}

export interface RequestWindowData {
  window_start: string; // ISO timestamp
  window_end: string; // ISO timestamp
  total_requests: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  slowest_routes: RouteStats[];
}

export interface DeploymentPayload {
  version: string;
  environment: string;
  branch: string;
  commit_message: string;
  framework: string;
  framework_version: string;
  node_version: string;
  region: string;
  deployment_url: string;
  metadata: Record<string, unknown>;
}

// The shape of every request body sent to /api/sdk/ingest
// All top-level fields are optional except version and timestamp
export interface IngestPayload {
  version: string; // SDK version, e.g. "1.0.0"
  timestamp: string; // ISO timestamp from client
  deployment?: DeploymentPayload;
  health_checks?: HealthCheckResult[];
  metrics?: MetricDatapoint[];
  runtime?: RuntimeStats;
  request_telemetry?: RequestWindowData;
}

export interface IngestResponse {
  received: boolean;
  processed: {
    deployment: boolean;
    health_checks: number;
    metrics: number;
    runtime: boolean;
    request_telemetry: boolean;
  };
  warnings: string[];
  timestamp: string;
}

export interface RelyClientOptions {
  // Required: API key from rely.net dashboard
  apiKey: string;

  // Optional: override the rely.net base URL
  // Useful for self-hosted instances or local development
  // Default: 'https://rely.net'
  baseUrl?: string;

  // Optional: environment label sent with all data
  // Default: process.env.NODE_ENV or 'production'
  environment?: Environment;

  // Optional: how often to flush data to rely.net in milliseconds
  // Default: 60000 (1 minute)
  // Minimum: 10000 (10 seconds)
  flushInterval?: number;

  // Optional: automatically redact secrets from error messages
  // Default: true (strongly recommended)
  sanitizeErrors?: boolean;

  // Optional: log debug information to console
  // Default: false
  debug?: boolean;
}
