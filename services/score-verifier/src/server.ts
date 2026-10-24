// Entry point: `node dist/server.js` (Dockerfile CMD) or `pnpm dev` from source.
import { createVerifierServer } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { type ContentStore, DirectoryContentStore, FixtureContentStore } from "./content-store.ts";
import { jsonLogger } from "./http-util.ts";

const logger = jsonLogger();

function main(): void {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    logger.error("config", { err: e instanceof ConfigError ? e.message : "invalid configuration" });
    process.exit(1);
  }
  const store: ContentStore =
    config.contentDir === null
      ? new FixtureContentStore()
      : new DirectoryContentStore(config.contentDir);
  if (store.kind === "fixtures") {
    logger.warn("content", {
      detail: "VERIFIER_CONTENT_DIR not set: serving built-in golden fixtures (dev only)",
    });
  }
  const server = createVerifierServer({ config, store, logger });
  server.listen(config.port, config.host, () => {
    const addr = server.address();
    logger.info("listening", {
      port: typeof addr === "object" && addr !== null ? addr.port : config.port,
      content: store.kind,
    });
  });
  const stop = (signal: string): void => {
    logger.info("shutdown", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main();
