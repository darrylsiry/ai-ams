// Lets `node --test` run the app's TypeScript modules directly: Node strips the types, and this hook
// resolves what Next's bundler would (extensionless relative imports and the "@/" alias for src/).
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../src");

registerHooks({
  resolve(specifier, context, next) {
    const spec = specifier.startsWith("@/") ? pathToFileURL(path.join(SRC, specifier.slice(2))).href : specifier;
    try {
      return next(spec, context);
    } catch (err) {
      if (!(spec.startsWith(".") || spec.startsWith("file:"))) throw err;
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        try { return next(spec + ext, context); } catch {}
      }
      throw err;
    }
  },
});
