import type {
  DeploymentInfo,
  Environment,
  HealthCheckFn,
  HealthCheckResult,
  IngestPayload,
  IngestResponse,
  MetricDatapoint,
  RelyClientOptions,
  RuntimeStats,
} from "./types";
import { RequestBuffer } from "./collectors/requests";

const SDK_VERSION = "1.0.0";

const SECRET_PATTERNS: RegExp[] = [
  /sk_live_[a-zA-Z0-9_]+/g,
  /sk_test_[a-zA-Z0-9_]+/g,
  /pk_live_[a-zA-Z0-9_]+/g,
  /pk_test_[a-zA-Z0-9_]+/g,
  /rely_live_[a-zA-Z0-9_]+/g,
  /rely_test_[a-zA-Z0-9_]+/g,
  /Bearer\s+[a-zA-Z0-9._\-]+/g,
  /password\s*[=:]\s*["']?[^\s"',}\]]{4,}/gi,
  /secret\s*[=:]\s*["']?[^\s"',}\]]{4,}/gi,
  /api[_\-]?key\s*[=:]\s*["']?[^\s"',}\]]{4,}/gi,
  /token\s*[=:]\s*["']?[^\s"',}\]]{4,}/gi,
  /AKIA[A-Z0-9]{16}/g,
  /[a-z0-9]{32,}:[a-z0-9]{32,}/g, // generic key:secret format
];

const MIN_FLUSH_INTERVAL = 10_000; // 10 seconds minimum
const DEFAULT_FLUSH_INTERVAL = 60_000; // 1 minute default
const INGEST_TIMEOUT_MS = 10_000; // 10 second timeout on API calls
const MAX_ERROR_MESSAGE_LENGTH = 2_000;
const MAX_STACK_TRACE_LENGTH = 10_000;
const MAX_METRIC_NAME_LENGTH = 100;
const MAX_HEALTH_CHECK_NAME_LENGTH = 100;

export class RelyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly environment: Environment;
  private readonly flushInterval: number;
  private readonly sanitizeErrors: boolean;
  private readonly debug: boolean;

  private healthChecks: Map<string, HealthCheckFn>;
  private pendingMetrics: MetricDatapoint[];
  private requestBuffer: RequestBuffer;
  private flushTimer: ReturnType<typeof setInterval> | null;
  private deploymentSent: boolean;
  private isDestroyed: boolean;

  constructor(options: RelyClientOptions) {
    // Validate required options
    if (!options.apiKey || typeof options.apiKey !== "string") {
      throw new Error(
        "[Rely] apiKey is required. Get your API key at rely.net/settings/api-keys"
      );
    }

    if (!options.apiKey.startsWith("rely_")) {
      console.warn(
        "[Rely] Warning: API key format looks incorrect. " +
          "Keys should start with rely_live_ or rely_test_"
      );
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://rely.net").replace(/\/$/, "");
    this.environment =
      options.environment ??
      (process.env.NODE_ENV as Environment) ??
      "production";
    this.flushInterval = Math.max(
      MIN_FLUSH_INTERVAL,
      options.flushInterval ?? DEFAULT_FLUSH_INTERVAL
    );
    this.sanitizeErrors = options.sanitizeErrors ?? true;
    this.debug = options.debug ?? false;

    this.healthChecks = new Map();
    this.pendingMetrics = [];
    this.requestBuffer = new RequestBuffer();
    this.flushTimer = null;
    this.deploymentSent = false;
    this.isDestroyed = false;

    this.log(`SDK initialized`);
    this.log(`Environment: ${this.environment}`);
    this.log(`Flush interval: ${this.flushInterval / 1000}s`);
    this.log(`Base URL: ${this.baseUrl}`);

    this.initialize();
  }

  // Register a health check function.
  // The function should throw if the check fails.
  // Returns `this` for chaining.
  healthCheck(name: string, fn: HealthCheckFn): this {
    if (this.isDestroyed) {
      this.log("Warning: SDK has been destroyed, ignoring healthCheck()");
      return this;
    }

    const trimmedName = name?.trim();
    if (!trimmedName) {
      throw new Error("[Rely] Health check name must be a non-empty string");
    }
    if (trimmedName.length > MAX_HEALTH_CHECK_NAME_LENGTH) {
      throw new Error(
        `[Rely] Health check name must be under ${MAX_HEALTH_CHECK_NAME_LENGTH} characters`
      );
    }
    if (typeof fn !== "function") {
      throw new Error(
        "[Rely] Health check must be a function that returns a Promise"
      );
    }

    this.healthChecks.set(trimmedName, fn);
    this.log(`Registered health check: "${trimmedName}"`);
    return this;
  }

  // Send a custom metric value.
  // Returns `this` for chaining.
  metric(name: string, value: number, tags?: Record<string, string>): this {
    if (this.isDestroyed) return this;

    if (typeof value !== "number" || !isFinite(value)) {
      this.log(`Warning: invalid metric value for "${name}": ${value}`);
      return this;
    }

    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName.length > MAX_METRIC_NAME_LENGTH) {
      this.log(`Warning: invalid metric name: "${name}"`);
      return this;
    }

    this.pendingMetrics.push({
      name: trimmedName,
      value,
      tags: tags ? this.sanitizeTags(tags) : undefined,
    });

    return this;
  }

  // Manually send a deployment marker.
  // Called automatically on initialization in production.
  // Use this to send additional metadata with your deployment.
  deployment(info: DeploymentInfo): void {
    if (this.isDestroyed) return;
    this.sendDeploymentMarker(info);
  }

  // Called by withRelyMiddleware on each HTTP request.
  // Not intended to be called directly in most cases.
  recordRequest(route: string, statusCode: number, durationMs: number): void {
    if (this.isDestroyed) return;
    this.requestBuffer.record(route, statusCode, durationMs);
  }

  // Manually trigger a flush of all pending data.
  // The SDK flushes automatically on the flush interval.
  // Use this for graceful shutdown scenarios.
  async flush(): Promise<void> {
    if (this.isDestroyed) return;

    const payload: IngestPayload = {
      version: SDK_VERSION,
      timestamp: new Date().toISOString(),
    };

    // Run health checks concurrently
    if (this.healthChecks.size > 0) {
      payload.health_checks = await this.runHealthChecks();
    }

    // Include pending metrics
    if (this.pendingMetrics.length > 0) {
      payload.metrics = [...this.pendingMetrics];
      this.pendingMetrics = [];
    }

    // Include runtime stats
    payload.runtime = this.collectRuntimeStats();

    // Include request telemetry if any requests were recorded
    if (this.requestBuffer.totalRequests > 0) {
      payload.request_telemetry = this.requestBuffer.flush();
    }

    await this.sendPayload(payload);
  }

  // Destroy the client and stop all background activity.
  // Call this during graceful shutdown if needed.
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.log("SDK destroyed");
  }

  private initialize(): void {
    // Send deployment marker on startup in production/staging
    if (
      this.environment === "production" ||
      this.environment === "staging"
    ) {
      this.sendDeploymentMarker();
    }

    // Start the periodic flush loop
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.log(`Flush error: ${err instanceof Error ? err.message : err}`);
      });
    }, this.flushInterval);

    // Prevent interval from keeping the Node.js process alive
    // after the application exits
    if (typeof this.flushTimer === "object" && this.flushTimer !== null) {
      const timer = this.flushTimer as { unref?: () => void };
      if (typeof timer.unref === "function") {
        timer.unref();
      }
    }
  }

  private async runHealthChecks(): Promise<HealthCheckResult[]> {
    const results = await Promise.allSettled(
      Array.from(this.healthChecks.entries()).map(
        async ([name, fn]): Promise<HealthCheckResult> => {
          const start = Date.now();
          try {
            await fn();
            const duration = Date.now() - start;
            this.log(`\u2713 Health check "${name}" passed (${duration}ms)`);
            return {
              name,
              status: "passing",
              duration_ms: duration,
            };
          } catch (err) {
            const duration = Date.now() - start;
            const error =
              err instanceof Error ? err : new Error(String(err));

            this.log(`\u2717 Health check "${name}" failed: ${error.message}`);

            return {
              name,
              status: "failing",
              duration_ms: duration,
              error_message: this.sanitizeErrors
                ? this.sanitize(
                    error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
                  )
                : error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
              stack_trace: error.stack
                ? this.sanitizeErrors
                  ? this.sanitize(
                      error.stack.slice(0, MAX_STACK_TRACE_LENGTH)
                    )
                  : error.stack.slice(0, MAX_STACK_TRACE_LENGTH)
                : undefined,
            };
          }
        }
      )
    );

    return results
      .filter(
        (r): r is PromiseFulfilledResult<HealthCheckResult> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value);
  }

  private collectRuntimeStats(): RuntimeStats {
    const mem = process.memoryUsage();
    return {
      memory_heap_used_mb:
        Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      memory_heap_total_mb:
        Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      memory_rss_mb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      cpu_usage_percent: 0,
      process_uptime_secs: Math.floor(process.uptime()),
      node_version: process.version,
      region:
        process.env.VERCEL_REGION ??
        process.env.AWS_REGION ??
        process.env.FLY_REGION ??
        process.env.RAILWAY_REGION ??
        "unknown",
    };
  }

  private sendDeploymentMarker(info?: DeploymentInfo): void {
    // Only send once per process unless called explicitly
    if (this.deploymentSent && !info) return;
    this.deploymentSent = true;

    const payload: IngestPayload = {
      version: SDK_VERSION,
      timestamp: new Date().toISOString(),
      deployment: {
        version:
          info?.version ??
          process.env.VERCEL_GIT_COMMIT_SHA ??
          process.env.RAILWAY_GIT_COMMIT_SHA ??
          process.env.FLY_APP_VERSION ??
          process.env.RENDER_GIT_COMMIT ??
          "unknown",
        environment: info?.environment ?? this.environment,
        branch:
          info?.branch ??
          process.env.VERCEL_GIT_COMMIT_REF ??
          process.env.RAILWAY_GIT_BRANCH ??
          process.env.RENDER_GIT_BRANCH ??
          "unknown",
        commit_message:
          info?.commit_message ??
          process.env.VERCEL_GIT_COMMIT_MESSAGE ??
          "",
        framework: "next.js",
        framework_version: this.detectFrameworkVersion(),
        node_version: process.version,
        region: process.env.VERCEL_REGION ?? "unknown",
        deployment_url: process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "",
        metadata: (info?.metadata as Record<string, unknown>) ?? {},
      },
    };

    this.sendPayload(payload).catch(() => {});
  }

  private async sendPayload(payload: IngestPayload): Promise<void> {
    try {
      this.log(`Sending payload (${JSON.stringify(payload).length} bytes)`);

      const response = await fetch(`${this.baseUrl}/api/sdk/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": `@rely-net/sdk/${SDK_VERSION}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
      });

      if (this.debug) {
        if (response.ok) {
          const body = (await response.json()) as IngestResponse;
          this.log(`Flush successful`);
          if (body.warnings?.length > 0) {
            body.warnings.forEach((w) => this.log(`Warning: ${w}`));
          }
        } else {
          this.log(`Ingest returned HTTP ${response.status}`);
        }
      }
    } catch (err) {
      // Never throw — SDK must never crash the host application
      this.log(
        `Send failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private sanitize(str: string): string {
    let result = str;
    for (const pattern of SECRET_PATTERNS) {
      // Reset regex lastIndex to avoid stateful regex bugs
      pattern.lastIndex = 0;
      result = result.replace(pattern, "[REDACTED]");
    }
    return result;
  }

  private sanitizeTags(
    tags: Record<string, string>
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags)) {
      // Truncate long tag values, sanitize for secrets
      sanitized[key] = this.sanitize(String(value).slice(0, 200));
    }
    return sanitized;
  }

  private detectFrameworkVersion(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require("next/package.json") as { version: string };
      return pkg.version;
    } catch {
      return "unknown";
    }
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[Rely] ${message}`);
    }
  }
}
