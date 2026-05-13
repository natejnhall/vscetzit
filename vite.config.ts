import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  if (mode === "extension") {
    return {
      build: {
        lib: {
          entry: resolve(__dirname, "src/extension/extension.ts"),
          name: "extension",
          fileName: "extension",
          formats: ["es"],
        },
        outDir: "dist",
        emptyOutDir: false,
        rollupOptions: {
          external: ["vscode", "path", "child_process", "fs", "util", "events", "stream"],
        },
        target: "node16",
      },
      plugins: [],
    };
  } else if (mode === "webview") {
    return {
      build: {
        lib: {
          entry: resolve(__dirname, "src/gui/CetzitExtensionHost.tsx"),
          name: "cetzit_vscode",
          fileName: "cetzit_vscode",
          formats: ["es"],
        },
        outDir: "dist",
        emptyOutDir: false,
        assetsInlineLimit: 16384,
      },
      assetsInclude: ["**/*.svg"],
      plugins: [preact()],
      define: {
        "process.env.NODE_ENV": '"production"',
      },
    };
  } else {
    return {
      build: {
        outDir: "dist",
        emptyOutDir: false,
        assetsInlineLimit: 16384,
        rollupOptions: {
          output: {
            entryFileNames: `assets/[name].js`,
            chunkFileNames: `assets/[name].js`,
            assetFileNames: `assets/[name].[ext]`,
          },
        },
      },
      assetsInclude: ["**/*.svg"],
      plugins: [preact()],
      define: {
        "process.env.NODE_ENV": '"production"',
      },
    };
  }
});
