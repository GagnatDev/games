// Bundle the server into a single CommonJS file and copy the SQL migrations next
// to it, so the runtime image needs no node_modules at all (see ../../Dockerfile).
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(backendDir, "dist");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [resolve(backendDir, "src/server.ts")],
  // .cjs, not .js: the bundle is CommonJS (which keeps it free of ESM/CJS interop
  // shims for dependencies like pg and node-pg-migrate), and this package is
  // `"type": "module"`, so a .js file here would be loaded as ESM and die on the
  // first `require`. The explicit extension makes it work from anywhere.
  outfile: resolve(outDir, "server.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  minify: false,
  logLevel: "info",
  // Optional native/dev-only requires that must not be pulled into the bundle.
  external: ["pg-native", "pino-pretty"],
});

await cp(resolve(backendDir, "migrations"), resolve(outDir, "migrations"), {
  recursive: true,
});

console.log("backend bundled to dist/server.cjs (+ dist/migrations)");
