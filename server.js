import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.pkg ? join(process.execPath, "..") : fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const configuredPort = Number(process.env.PORT || 3000);
const apiBase = "https://ctrlem.com/api/v1";
const imageChestBase = "https://api.imgchest.com/v1";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function apiHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function proxyApi(request, response, path, upstreamMethod = request.method) {
  let body;
  try {
    body = await readBody(request);
  } catch {
    return sendJson(response, 400, { error: "Request body must be valid JSON." });
  }

  if (!body.apiKey?.trim()) return sendJson(response, 400, { error: "An API key is required." });

  const options = { method: upstreamMethod, headers: apiHeaders(body.apiKey), signal: AbortSignal.timeout(30000) };
  if (upstreamMethod === "POST") {
    options.body = JSON.stringify(body.payload);
  }

  try {
    const upstream = await fetch(`${apiBase}${path}`, options);
    const text = await upstream.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text.slice(0, 2000) }; }
    return sendJson(response, upstream.ok ? 200 : upstream.status, {
      ok: upstream.ok, status: upstream.status, result
    });
  } catch (error) {
    return sendJson(response, 502, { error: `CtrlEm request failed: ${error.message}` });
  }
}

async function uploadToImageChest(request, response) {
  let body;
  try {
    body = await readBody(request);
  } catch {
    return sendJson(response, 400, { error: "Request body must be valid JSON." });
  }

  async function listImageChestPosts(request, response) {
    let body;
    try {
      body = await readBody(request);
    } catch {
      return sendJson(response, 400, { error: "Request body must be valid JSON." });
    }
    if (!body.token?.trim()) return sendJson(response, 400, { error: "An ImageChest token is required." });

    try {
      const authHeaders = { Authorization: `Bearer ${body.token.trim()}` };
      const userResponse = await fetch(`${imageChestBase}/users/me`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(30000)
      });
      const userText = await userResponse.text();
      const userResult = JSON.parse(userText);
      if (!userResponse.ok || !userResult.data?.name) {
        return sendJson(response, userResponse.status, { ok: false, status: userResponse.status, result: userResult });
      }

      const posts = [];
      let page = 1;
      let lastPage = 1;
      do {
        const postsResponse = await fetch(
          `${imageChestBase}/user/${encodeURIComponent(userResult.data.name)}/posts?per_page=100&sort=new&page=${page}`,
          { headers: authHeaders, signal: AbortSignal.timeout(30000) }
        );
        const postsText = await postsResponse.text();
        const postsResult = JSON.parse(postsText);
        if (!postsResponse.ok) {
          return sendJson(response, postsResponse.status, { ok: false, status: postsResponse.status, result: postsResult });
        }
        posts.push(...(postsResult.data || []));
        lastPage = postsResult.meta?.last_page || 1;
        page += 1;
      } while (page <= lastPage);

      return sendJson(response, 200, { ok: true, result: { posts } });
    } catch (error) {
      return sendJson(response, 502, { error: `ImageChest lookup failed: ${error.message}` });
    }
  }
  if (!body.token?.trim() || !Array.isArray(body.images) || body.images.length === 0) {
    return sendJson(response, 400, { error: "An ImageChest token and at least one image are required." });
  }
  if (body.images.length > 20) {
    return sendJson(response, 400, { error: "Batch uploads support a maximum of 20 images." });
  }

  const form = new FormData();
  form.append("title", body.title?.trim() || "CtrlEm image queue");
  form.append("privacy", "hidden");
  form.append("nsfw", "true");
  for (const image of body.images) {
    if (!image?.name || !image.data) {
      return sendJson(response, 400, { error: "Each image must include a name and base64 data." });
    }
    form.append(
      "images[]",
      new Blob([Buffer.from(image.data, "base64")], { type: image.type || "application/octet-stream" }),
      image.name
    );
  }

  try {
    const upstream = await fetch(`${imageChestBase}/post`, {
      method: "POST",
      headers: { Authorization: `Bearer ${body.token.trim()}` },
      body: form,
      signal: AbortSignal.timeout(120000)
    });
    const text = await upstream.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text.slice(0, 2000) }; }
    return sendJson(response, upstream.ok ? 200 : upstream.status, {
      ok: upstream.ok, status: upstream.status, result
    });
  } catch (error) {
    return sendJson(response, 502, { error: `ImageChest request failed: ${error.message}` });
  }
}

async function serveStatic(request, response) {
  const requested = request.url === "/" ? "/index.html" : new URL(request.url, "http://localhost").pathname;
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return sendJson(response, 403, { error: "Forbidden." });
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  } catch { sendJson(response, 404, { error: "Not found." }); }
}

function createAppServer() {
  return createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/users") return proxyApi(request, response, "/users", "GET");
  if (request.method === "POST" && request.url === "/api/command") return proxyApi(request, response, "/command");
  if (request.method === "POST" && request.url === "/api/imgchest/upload") return uploadToImageChest(request, response);
  if (request.method === "POST" && request.url === "/api/imgchest/posts") return listImageChestPosts(request, response);
  if (request.method === "GET") return serveStatic(request, response);
  sendJson(response, 405, { error: "Method not allowed." });
  });
}

export function startServer(port = configuredPort) {
  const server = createAppServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({ server, port: server.address().port });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().then(({ port }) => {
    console.log(`CtrlEm image queue running at http://127.0.0.1:${port}`);
  }).catch((error) => {
    console.error(`Could not start CtrlEm image queue: ${error.message}`);
    process.exitCode = 1;
  });
}
