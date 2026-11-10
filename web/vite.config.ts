import { defineConfig } from "vite";
import { bundledLicenseNotices } from "../scripts/license-notices.mjs";
export default defineConfig({
  root: "web",
  plugins: [bundledLicenseNotices()],
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@codemirror") || id.includes("@lezer"))
            return "editor";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
  server: { host: "127.0.0.1" },
});
