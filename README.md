# @rely-net/sdk

Official SDK for [rely.net](https://rely.net) — monitor your application from the inside.

## What it does

- Sends health check results from inside your app to rely.net
- Attributes outgoing HTTP calls to vendors (Stripe, OpenAI, etc.) with per-vendor p95 + error rates
- Tracks custom metrics alongside vendor status
- Marks deployments on your monitoring charts
- Captures request telemetry (error rate, response times)
- Sends runtime stats (memory usage, uptime)

## Installation

```bash
npm install @rely-net/sdk
```

## Install with a coding agent

Paste the prompt below into Claude Code, Codex, Cursor, or your agent of choice. It will install the SDK, wire up health checks for the services your app actually depends on, and integrate the Next.js middleware.

```
Install the @rely-net/sdk package to monitor this Next.js app.

Do the following:

1. Install the package:
   npm install @rely-net/sdk

2. Create /instrumentation.ts at the project root with:
   - A Rely client initialized from process.env.RELY_API_KEY
   - One healthCheck() for each external service this app depends on.
     Look through the codebase for env vars like SUPABASE_*, STRIPE_*,
     ANTHROPIC_API_KEY, OPENAI_*, and add a health check for each.
     Use the patterns in the README below.

3. Update middleware.ts to wrap the existing middleware with
   withRelyMiddleware(rely, existingMiddleware). If there is no existing
   middleware, export withRelyMiddleware(rely) directly. Keep the matcher
   excluding _next/static, _next/image, and favicon.ico.

4. Add RELY_API_KEY= to .env.local and mention that the user needs to
   get their API key from rely.net/settings/api-keys and add it to
   production env vars as well.

5. Run a build to verify nothing is broken.

Reference README with health check snippets for common services:
https://github.com/mdicarlo-scaled/rely-net

The SDK automatically wraps global fetch to track outgoing vendor
calls (Stripe, Anthropic, Supabase, etc.) with p50/p95/p99 latency and
error rates, so no additional code is needed beyond the above steps.
```

For non-Next.js frameworks, drop step 3 (the middleware integration).

## Quick start (Next.js)

### 1. Get your API key

Go to [rely.net/settings/api-keys](https://rely.net/settings/api-keys) and create a new key.

### 2. Add to your environment

```bash
# .env.local
RELY_API_KEY=rely_live_...
```

### 3. Create `instrumentation.ts`

Create a file called `instrumentation.ts` in your Next.js project root:

```ts
import { Rely } from '@rely-net/sdk'

export const rely = new Rely({
  apiKey: process.env.RELY_API_KEY!,
})

// Add health checks for your services
rely.healthCheck('database', async () => {
  const { supabase } = await import('@/lib/supabase/client')
  const { error } = await supabase.from('_health').select('1')
  if (error) throw error
})
```

That's it. The SDK will start sending data to rely.net within 60 seconds.

## Health check examples

Copy-paste snippets for common services:

### Supabase

```ts
rely.healthCheck('supabase', async () => {
  const { error } = await supabase.from('_health').select('1')
  if (error) throw error
})
```

### Stripe

```ts
rely.healthCheck('stripe', async () => {
  await stripe.balance.retrieve()
})
```

### Resend

```ts
rely.healthCheck('resend', async () => {
  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
  })
  if (!res.ok) throw new Error(`Resend returned ${res.status}`)
})
```

### Redis / Upstash

```ts
rely.healthCheck('redis', async () => {
  await redis.ping()
})
```

### PlanetScale / MySQL

```ts
rely.healthCheck('database', async () => {
  await db.execute('SELECT 1')
})
```

### OpenAI

```ts
rely.healthCheck('openai', async () => {
  await openai.models.list()
})
```

### Anthropic

```ts
rely.healthCheck('anthropic', async () => {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY! }
  })
  if (!res.ok) throw new Error(`Anthropic returned ${res.status}`)
})
```

## Custom metrics

Send any numeric value to chart it in rely.net:

```ts
rely.metric('checkout.conversion_rate', 0.034)
rely.metric('queue.depth', 142, { queue: 'email' })
rely.metric('api.active_connections', 58)
```

Metrics are sent on the next flush (default: every 60 seconds).

## Request telemetry (Next.js middleware)

Automatically capture error rates and response times:

```ts
// middleware.ts (in your Next.js project root)
import { withRelyMiddleware } from '@rely-net/sdk'
import { rely } from './instrumentation'

export default withRelyMiddleware(rely)

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

## Outgoing vendor calls

The SDK wraps the global `fetch` on init to bucket outgoing HTTP calls by hostname and report p50/p95/p99 + error rates per vendor. rely.net matches hostnames to known vendors (Stripe, OpenAI, Supabase, etc.) so you see vendor latency from your app's perspective — the answer to "is it me or is it Stripe?" without writing any code.

Enabled by default. Disable with:

```ts
new Rely({
  apiKey: process.env.RELY_API_KEY!,
  instrumentFetch: false,
})
```

Self-calls to the rely.net ingest endpoint are always skipped.

## Deployment markers

Deployment markers are sent automatically when the SDK initializes. They appear as vertical lines on your charts in rely.net, making it easy to correlate issues with deploys.

To send a manual deployment marker with custom metadata:

```ts
rely.deployment({
  version: process.env.MY_APP_VERSION,
  metadata: { team: 'backend', feature_flags: 'new-checkout' }
})
```

## Configuration options

```ts
new Rely({
  apiKey: string,           // required
  baseUrl?: string,         // default: 'https://rely.net'
  environment?: string,     // default: process.env.NODE_ENV
  flushInterval?: number,   // default: 60000 (ms)
  sanitizeErrors?: boolean, // default: true (recommended)
  instrumentFetch?: boolean,// default: true (wraps global fetch)
  debug?: boolean,          // default: false
})
```

## Security

By default, the SDK automatically redacts common secret patterns from error messages before sending them to rely.net. This protects API keys, tokens, and passwords from being accidentally transmitted.

Patterns redacted include:

- Stripe API keys (`sk_live_`, `pk_live_`, etc.)
- Bearer tokens
- Passwords and secrets in error strings
- AWS access key patterns
- rely.net API keys

Set `sanitizeErrors: false` only if you have verified your error messages never contain sensitive data.

## TypeScript

The SDK is written in TypeScript and ships with full type definitions. No `@types` package needed.

```ts
import type { HealthCheckFn, RelyClientOptions } from '@rely-net/sdk'
```

## License

MIT
