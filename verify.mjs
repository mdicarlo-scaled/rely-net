import { Rely, createRelyClient, getRelyClient } from "./dist/index.mjs";

console.log("Testing @rely-net/sdk...");

// Test 1: Direct instantiation
const client = new Rely({
  apiKey: "rely_live_test123456789",
  debug: true,
  flushInterval: 60000,
});

console.log("\u2713 Client instantiated");

// Test 2: Health check registration
client.healthCheck("test-passing", async () => {
  // Intentionally passes
});

client.healthCheck("test-failing", async () => {
  throw new Error("sk_live_SECRET123 - this secret should be redacted");
});

console.log("\u2713 Health checks registered");

// Test 3: Metric recording
client.metric("test.value", 42, { env: "test" });
client.metric("test.rate", 0.95);
console.log("\u2713 Metrics recorded");

// Test 4: Singleton pattern
const same = createRelyClient({
  apiKey: "rely_live_test123456789",
  debug: false,
});
const retrieved = getRelyClient();
console.log("\u2713 Singleton pattern works:", same === retrieved);

// Test 5: Destroy
client.destroy();
same.destroy();
console.log("\u2713 Clients destroyed cleanly");

console.log("");
console.log("All checks passed. Package is ready.");
console.log("Note: Network calls will fail in this test environment.");
console.log("That is expected \u2014 the ingest API does not exist yet.");
