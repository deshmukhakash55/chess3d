import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("stockfish")) {
            return "stockfish.js";
          }
        },
        chunkFileNames: ({ name }) => {
          if (name.includes("stockfish")) return "[name]";
        },
        assetFileNames: ({ name }) => {
          if (name.includes("stockfish")) return "[name].[ext]";

          return "assets/[name]-[hash].[ext]";
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
