import path from "node:path";
import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const sentryAuth = process.env.SENTRY_AUTH_TOKEN?.trim() ?? "";
const sentryOrg = process.env.SENTRY_ORG?.trim() ?? "";
const sentryProject = process.env.SENTRY_PROJECT?.trim() ?? "";
const uploadSourcemaps = Boolean(sentryAuth && sentryOrg && sentryProject);

export default defineConfig({
  define: {
    __STARHOLD_SENTRY_DSN__: JSON.stringify(process.env.SENTRY_DSN ?? ""),
    __STARHOLD_POSTHOG_KEY__: JSON.stringify(process.env.POSTHOG_KEY ?? ""),
  },
  resolve: {
    alias: {
      // Dev against shared source so formula tweaks show up without a stale dist.
      "@starhold/game": path.resolve(rootDir, "../../packages/game/src/index.ts"),
    },
  },
  build: {
    sourcemap: uploadSourcemaps,
  },
  plugins: uploadSourcemaps
    ? [
        sentryVitePlugin({
          org: sentryOrg,
          project: sentryProject,
          authToken: sentryAuth,
          telemetry: false,
          sourcemaps: {
            filesToDeleteAfterUpload: ["./dist/**/*.map"],
          },
          errorHandler(err) {
            console.warn(`[sentry] source map upload skipped: ${err.message}`);
          },
        }),
      ]
    : [],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Cloudflare quick tunnels / playtest hosts (not just localhost).
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});