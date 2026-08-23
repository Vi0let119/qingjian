import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const root = process.cwd();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // 防止 Vite 吞掉 Rust 编译错误
  clearScreen: false,
  // Tauri 期望固定端口
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 不监听 src-tauri 变化
      ignored: ["**/src-tauri/**"],
    },
  },
  // 产物目录（Tauri frontendDist 指向 ../dist）
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        fragment: resolve(root, "fragment.html"),
        settings: resolve(root, "settings.html"),
      },
    },
  },
});
