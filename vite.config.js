import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          // markdown 渲染只在详情页用到，单独切出来
          markdown: ["marked", "dompurify"],
        },
      },
    },
  },
  server: {
    port: 5183,
    open: false,
    // 本地联调：把 API 转给 `wrangler pages dev`（默认 8790）
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
      },
    },
  },
});
