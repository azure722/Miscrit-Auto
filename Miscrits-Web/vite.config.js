import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4318",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (outgoing, incoming) => {
            // Translate only this loopback dev origin; foreign origins stay rejected.
            if (incoming.headers.origin === "http://127.0.0.1:5173") {
              outgoing.setHeader("Origin", "http://127.0.0.1:4318");
            }
          });
        },
      },
    },
  },
  build: {
    // Fixed filenames keep the packaged local server's explicit asset allowlist.
    rolldownOptions: {
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: "style.[ext]",
        codeSplitting: false,
      },
    },
  },
});
