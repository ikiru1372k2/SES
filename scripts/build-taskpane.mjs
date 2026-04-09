import { build } from "esbuild";

await build({
  entryPoints: ["src/taskpane/index.jsx"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "public/taskpane.js",
  jsx: "automatic",
  sourcemap: false,
  logLevel: "info",
});
