import { defineConfig } from "tsup";

export default defineConfig({
  // Two entry points so consumers can `import { phi } from "@pm-amm/sdk/math"`
  // with zero Solana code pulled into the graph.
  entry: ["src/index.ts", "src/math.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  // The Anchor IDL JSON is imported by the client; esbuild bundles it inline.
  // web3.js / anchor / spl-token are peerDependencies — keep them external.
  external: ["@solana/web3.js", "@anchor-lang/core", "@solana/spl-token"],
});
