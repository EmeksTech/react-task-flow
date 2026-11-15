import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectDirectory = fileURLToPath(new URL(".", import.meta.url));
const defaultDistDirectory = resolve(projectDirectory, "dist");
const allowedMethods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const forwardedHeaders = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function parseOrigin(value, name, requireHttps) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS origin.`);
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.origin !== value ||
    parsed.username ||
    parsed.password ||
    (requireHttps && parsed.protocol !== "https:")
  ) {
    throw new Error(`${name} must be a bare ${requireHttps ? "HTTPS" : "HTTP or HTTPS"} origin.`);
  }

  return parsed;
}

function getConfig(env) {
  const isProduction = env.NODE_ENV === "production" || env.RENDER === "true";
  const backendValue = env.TASKFLOW_BACKEND_URL;
  if (!backendValue) {
    throw new Error("TASKFLOW_BACKEND_URL is required.");
  }

  const backendOrigin = parseOrigin(
    backendValue,
    "TASKFLOW_BACKEND_URL",
    isProduction,
  );
  const publicOriginValue = env.PUBLIC_APP_ORIGIN ?? env.RENDER_EXTERNAL_URL;
  if (!publicOriginValue) {
    throw new Error("PUBLIC_APP_ORIGIN or RENDER_EXTERNAL_URL is required.");
  }

  const publicOrigin = parseOrigin(
    publicOriginValue,
    "PUBLIC_APP_ORIGIN",
    isProduction,
  );

  return { backendOrigin, publicOrigin };
}

function jsonResponse(response, status, code, message) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify({ error: { code, message } }));
}

function getRequestUrl(request, publicOrigin) {
  if (!request.url?.startsWith("/") || request.url.startsWith("//")) {
    return null;
  }

  try {
    const url = new URL(request.url, publicOrigin);
    return url.origin === publicOrigin.origin ? url : null;
  } catch {
    return null;
  }
}

function hasExpectedOrigin(origin, expectedOrigin) {
  if (typeof origin !== "string") return false;

  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && parsed.origin === expectedOrigin;
  } catch {
    return false;
  }
}

function getConnectionTokens(headers) {
  return new Set(
    (headers.connection ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean),
  );
}

function getProxyRequestHeaders(request) {
  const connectionTokens = getConnectionTokens(request.headers);
  const headers = {};

  for (const [name, value] of Object.entries(request.headers)) {
    const normalizedName = name.toLowerCase();
    if (
      value === undefined ||
      normalizedName === "host" ||
      hopByHopHeaders.has(normalizedName) ||
      connectionTokens.has(normalizedName) ||
      forwardedHeaders.has(normalizedName) ||
      normalizedName.startsWith("x-forwarded-") ||
      normalizedName.startsWith("x-vercel-")
    ) {
      continue;
    }

    headers[normalizedName] = value;
  }

  return headers;
}

function getProxyResponseHeaders(upstreamHeaders) {
  const connectionTokens = getConnectionTokens(upstreamHeaders);
  const headers = {};

  for (const [name, value] of Object.entries(upstreamHeaders)) {
    const normalizedName = name.toLowerCase();
    if (
      value === undefined ||
      hopByHopHeaders.has(normalizedName) ||
      connectionTokens.has(normalizedName)
    ) {
      continue;
    }

    headers[normalizedName] = value;
  }

  return headers;
}

function sendFile(request, response, filePath, fileSize, cacheControl) {
  response.writeHead(200, {
    "Cache-Control": cacheControl,
    "Content-Length": String(fileSize),
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    console.error("[Render Web Service] Static file read failed.", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    if (!response.headersSent) {
      jsonResponse(response, 500, "STATIC_FILE_ERROR", "Unable to serve this file.");
    } else {
      response.destroy(error);
    }
  });
  stream.pipe(response);
}

async function serveStatic(request, response, requestUrl, distDirectory) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestUrl.pathname);
  } catch {
    jsonResponse(response, 400, "INVALID_PATH", "The requested path is invalid.");
    return;
  }

  const resolvedDistDirectory = resolve(distDirectory);
  const requestedFile = resolve(resolvedDistDirectory, `.${decodedPath}`);
  if (
    requestedFile !== resolvedDistDirectory &&
    !requestedFile.startsWith(`${resolvedDistDirectory}${sep}`)
  ) {
    jsonResponse(response, 400, "INVALID_PATH", "The requested path is invalid.");
    return;
  }

  let filePath = requestedFile;
  let details;
  try {
    details = await stat(filePath);
    if (!details.isFile()) filePath = resolve(resolvedDistDirectory, "index.html");
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    filePath = resolve(resolvedDistDirectory, "index.html");
  }

  if (filePath !== requestedFile) {
    details = await stat(filePath);
  }

  const cacheControl =
    filePath.includes(`${sep}assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache";
  sendFile(request, response, filePath, details.size, cacheControl);
}

function proxyApiRequest(request, response, requestUrl, backendOrigin) {
  const transport = backendOrigin.protocol === "https:" ? https : http;
  const backendUrl = new URL(
    `${requestUrl.pathname}${requestUrl.search}`,
    backendOrigin,
  );
  const upstreamRequest = transport.request(
    backendUrl,
    {
      method: request.method,
      headers: getProxyRequestHeaders(request),
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        getProxyResponseHeaders(upstreamResponse.headers),
      );
      upstreamResponse.on("error", (error) => {
        console.error("[Render Web Service] API upstream response failed.", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        response.destroy(error);
      });
      upstreamResponse.pipe(response);
    },
  );

  let timedOut = false;
  upstreamRequest.setTimeout(30_000, () => {
    timedOut = true;
    upstreamRequest.destroy();
  });

  upstreamRequest.on("error", (error) => {
    console.error("[Render Web Service] API upstream request failed.", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    if (!response.headersSent) {
      jsonResponse(
        response,
        timedOut ? 504 : 502,
        timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        timedOut
          ? "The TaskFlow API request timed out."
          : "The TaskFlow API is temporarily unavailable.",
      );
    } else {
      response.destroy(error);
    }
  });

  request.on("aborted", () => upstreamRequest.destroy());
  request.on("error", (error) => upstreamRequest.destroy(error));
  response.on("close", () => {
    if (!response.writableEnded) upstreamRequest.destroy();
  });
  response.on("error", (error) => upstreamRequest.destroy(error));
  request.pipe(upstreamRequest);
}

export function createRenderWebServer({
  env = process.env,
  distDirectory = defaultDistDirectory,
} = {}) {
  const { backendOrigin, publicOrigin } = getConfig(env);
  if (!existsSync(resolve(distDirectory, "index.html"))) {
    throw new Error(`Build output is missing: ${resolve(distDirectory, "index.html")}`);
  }

  return http.createServer((request, response) => {
    const requestUrl = getRequestUrl(request, publicOrigin);
    if (!requestUrl) {
      jsonResponse(response, 400, "INVALID_REQUEST_TARGET", "The request target is invalid.");
      return;
    }

    const requestHost = request.headers.host?.toLowerCase();
    if (requestHost !== publicOrigin.host.toLowerCase()) {
      jsonResponse(response, 421, "INVALID_HOST", "The request host is not allowed.");
      return;
    }

    if (requestUrl.pathname === "/healthz") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
      if (!allowedMethods.has(request.method ?? "")) {
        jsonResponse(response, 405, "METHOD_NOT_ALLOWED", "This API method is not allowed.");
        return;
      }

      const origin = request.headers.origin;
      if (
        (origin !== undefined &&
          !hasExpectedOrigin(origin, publicOrigin.origin)) ||
        (stateChangingMethods.has(request.method ?? "") &&
          !hasExpectedOrigin(origin, publicOrigin.origin))
      ) {
        jsonResponse(response, 403, "INVALID_ORIGIN", "A same-origin request is required.");
        return;
      }

      proxyApiRequest(request, response, requestUrl, backendOrigin);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      jsonResponse(response, 405, "METHOD_NOT_ALLOWED", "This method is not allowed.");
      return;
    }

    serveStatic(request, response, requestUrl, distDirectory).catch((error) => {
      console.error("[Render Web Service] Static request failed.", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      if (!response.headersSent) {
        jsonResponse(response, 500, "STATIC_FILE_ERROR", "Unable to serve this page.");
      } else {
        response.destroy(error);
      }
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = createRenderWebServer();
    const port = Number(process.env.PORT ?? 10000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be an integer from 1 through 65535.");
    }
    server.listen(port, "0.0.0.0", () => {
      console.log(`[Render Web Service] Listening on port ${port}.`);
    });
    server.on("error", (error) => {
      console.error("[Render Web Service] Startup failed.", {
        errorType: error.name,
      });
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(
      "[Render Web Service] Startup failed.",
      error instanceof Error ? error.message : "Unknown error.",
    );
    process.exitCode = 1;
  }
}
