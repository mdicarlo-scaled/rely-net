import type { RelyClient } from "./client";

// Use type-only import to avoid bundling next/server
// when the package is used in non-Next.js environments
type NextMiddlewareResult = Response | undefined | null;
type NextMiddleware = (
  request: Request,
  event: unknown
) => NextMiddlewareResult | Promise<NextMiddlewareResult>;

type WrappedMiddleware = (
  request: Request,
  event: unknown
) => Promise<NextMiddlewareResult>;

export function withRelyMiddleware(
  rely: RelyClient,
  middleware?: NextMiddleware
): WrappedMiddleware {
  return async (request: Request, event: unknown) => {
    const start = Date.now();
    const url = new URL(request.url);

    let response: Response | undefined | null;

    if (middleware) {
      response = await middleware(request, event);
    } else {
      // Dynamic import to avoid bundling next/server
      const { NextResponse } = await import("next/server" as string);
      response = NextResponse.next();
    }

    const duration = Date.now() - start;
    const status = response?.status ?? 200;

    // Skip internal Next.js routes to reduce noise
    const path = url.pathname;
    if (
      !path.startsWith("/_next/") &&
      !path.startsWith("/favicon") &&
      !path.startsWith("/robots") &&
      !path.startsWith("/sitemap")
    ) {
      rely.recordRequest(path, status, duration);
    }

    return response;
  };
}
