import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import {
  isStateChangingRequest,
  isTrustedTaskFlowProxyRequest,
} from "./src/proxy/originPolicy.js";

function taskFlowOriginPolicy(
  targetOrigin: string,
  expectedOrigin: string,
): Plugin {
  return {
    name: "taskflow-local-origin-policy",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/")) {
          next();
          return;
        }

        const origin = request.headers.origin;
        const method = (request.method ?? "GET").toUpperCase();
        if (!isTrustedTaskFlowProxyRequest(method, origin ?? null, expectedOrigin)) {
          response.statusCode = 403;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error: {
                code: "INVALID_ORIGIN",
                message: "A same-origin request is required.",
              },
            }),
          );
          return;
        }

        if (isStateChangingRequest(method)) {
          request.headers.origin = targetOrigin;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target =
    env.TASKFLOW_BACKEND_URL ?? "https://task-flow-six-rouge.vercel.app";
  const apiMode = env.VITE_API_MODE ?? "mock";
  const port = Number(env.TASKFLOW_DEV_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("TASKFLOW_DEV_PORT must be an integer from 1 through 65535.");
  }
  const devOrigin = `http://localhost:${port}`;

  try {
    const parsedTarget = new URL(target);
    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
      throw new Error("Use an HTTP or HTTPS backend URL.");
    }
  } catch {
    throw new Error("TASKFLOW_BACKEND_URL must be a valid HTTP or HTTPS URL.");
  }

  return {
    plugins: [
      react(),
      ...(apiMode === "taskflow"
        ? [taskFlowOriginPolicy(new URL(target).origin, devOrigin)]
        : []),
    ],
    server: {
      host: "localhost",
      port,
      strictPort: true,
      ...(apiMode === "taskflow" ? { cors: false } : {}),
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
