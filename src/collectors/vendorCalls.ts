// Per-hostname aggregation of outgoing HTTP calls.
// Captures call count, error count (>=400 or thrown), and p50/95/99 latency.

export interface VendorCallWindowData {
  window_start: string;
  window_end: string;
  hostname: string;
  call_count: number;
  error_count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

interface HostData {
  durations: number[];
  errors: number;
}

export class VendorCallBuffer {
  private hosts: Map<string, HostData>;
  private windowStart: Date;

  constructor() {
    this.hosts = new Map();
    this.windowStart = new Date();
  }

  record(hostname: string, durationMs: number, isError: boolean): void {
    if (!hostname) return;
    let data = this.hosts.get(hostname);
    if (!data) {
      data = { durations: [], errors: 0 };
      this.hosts.set(hostname, data);
    }
    data.durations.push(Math.max(0, durationMs));
    if (isError) data.errors += 1;
  }

  get totalCalls(): number {
    let total = 0;
    for (const d of Array.from(this.hosts.values())) total += d.durations.length;
    return total;
  }

  flush(): VendorCallWindowData[] {
    const windowEnd = new Date().toISOString();
    const windowStart = this.windowStart.toISOString();
    const out: VendorCallWindowData[] = [];
    for (const [hostname, data] of Array.from(this.hosts.entries())) {
      out.push({
        window_start: windowStart,
        window_end: windowEnd,
        hostname,
        call_count: data.durations.length,
        error_count: data.errors,
        p50_ms: percentile(data.durations, 50),
        p95_ms: percentile(data.durations, 95),
        p99_ms: percentile(data.durations, 99),
      });
    }
    this.hosts = new Map();
    this.windowStart = new Date();
    return out;
  }
}
