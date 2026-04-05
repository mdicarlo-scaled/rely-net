import type { RequestWindowData, RouteStats } from "../types";

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

interface RouteData {
  durations: number[];
  statusCodes: number[];
}

export class RequestBuffer {
  private routes: Map<string, RouteData>;
  private windowStart: Date;

  constructor() {
    this.routes = new Map();
    this.windowStart = new Date();
  }

  record(route: string, statusCode: number, durationMs: number): void {
    const normalized = this.normalizeRoute(route);

    if (!this.routes.has(normalized)) {
      this.routes.set(normalized, { durations: [], statusCodes: [] });
    }

    const r = this.routes.get(normalized)!;
    r.durations.push(Math.max(0, durationMs));
    r.statusCodes.push(statusCode);
  }

  flush(): RequestWindowData {
    const allDurations: number[] = [];
    const allStatusCodes: number[] = [];
    const routeStats: RouteStats[] = [];

    for (const [route, data] of Array.from(this.routes.entries())) {
      allDurations.push(...data.durations);
      allStatusCodes.push(...data.statusCodes);
      routeStats.push({
        route,
        p95_ms: percentile(data.durations, 95),
        count: data.durations.length,
      });
    }

    const result: RequestWindowData = {
      window_start: this.windowStart.toISOString(),
      window_end: new Date().toISOString(),
      total_requests: allDurations.length,
      status_2xx: allStatusCodes.filter((s) => s >= 200 && s < 300).length,
      status_3xx: allStatusCodes.filter((s) => s >= 300 && s < 400).length,
      status_4xx: allStatusCodes.filter((s) => s >= 400 && s < 500).length,
      status_5xx: allStatusCodes.filter((s) => s >= 500).length,
      p50_ms: percentile(allDurations, 50),
      p95_ms: percentile(allDurations, 95),
      p99_ms: percentile(allDurations, 99),
      slowest_routes: routeStats
        .sort((a, b) => b.p95_ms - a.p95_ms)
        .slice(0, 10),
    };

    // Reset buffer for next window
    this.routes = new Map();
    this.windowStart = new Date();

    return result;
  }

  get totalRequests(): number {
    let total = 0;
    for (const data of Array.from(this.routes.values())) {
      total += data.durations.length;
    }
    return total;
  }

  // Replace dynamic path segments with placeholders to avoid
  // high-cardinality route keys in the database.
  // /users/123         → /users/[id]
  // /posts/abc-def-123 → /posts/[id]
  // /api/v1/orders/99  → /api/v1/orders/[id]
  private normalizeRoute(path: string): string {
    return (
      path
        // UUIDs
        .replace(
          /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
          "/[id]"
        )
        // Pure numeric IDs
        .replace(/\/\d+/g, "/[id]")
        // Alphanumeric slugs that look like IDs (20+ chars)
        .replace(/\/[a-zA-Z0-9]{20,}/g, "/[id]")
    );
  }
}
