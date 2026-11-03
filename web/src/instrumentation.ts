export async function register() {
  // Node only: the database client can't load in the edge runtime, so the work lives in its own module.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
