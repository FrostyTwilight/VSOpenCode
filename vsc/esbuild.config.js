const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const isWatch = process.argv.includes("--watch");

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: [path.resolve(__dirname, "src", "extension.ts")],
  bundle: true,
  platform: "node",
  target: "ES2022",
  format: "cjs",
  outfile: path.resolve(__dirname, "dist", "extension.js"),
  external: ["vscode"],
  minify: false,
  sourcemap: true,
};

/** @type {esbuild.BuildOptions | null} */
const webviewConfig = (() => {
  const webviewEntry = path.resolve(__dirname, "src", "webview", "index.ts");
  if (!fs.existsSync(webviewEntry)) {
    return null;
  }
  return {
    entryPoints: [webviewEntry],
    bundle: true,
    platform: "browser",
    target: "ES2022",
    format: "iife",
    outfile: path.resolve(__dirname, "dist", "webview.js"),
    minify: false,
    sourcemap: true,
  };
})();

const configs = [extensionConfig];
if (webviewConfig) {
  configs.push(webviewConfig);
}

async function build() {
  const promises = configs.map((config) => esbuild.build(config));
  await Promise.all(promises);
}

async function main() {
  if (isWatch) {
    const contexts = await Promise.all(
      configs.map((config) => esbuild.context(config))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("[esbuild] Watching for changes...");
  } else {
    await build();
    console.log("[esbuild] Build complete.");
  }
}

main().catch((err) => {
  console.error("[esbuild] Build failed:", err);
  process.exit(1);
});
