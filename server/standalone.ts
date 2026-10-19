import { join } from "node:path";
import { actions, type ActionName } from "./actions";

const PORT = Number(process.env.PORT ?? 3000);
const DIST = join(import.meta.dir, "..", "client", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 && MIME[path.slice(dot)]) || "application/octet-stream";
}

async function handleApi(action: string, req: Request): Promise<Response> {
  const entry = (actions as Record<string, (typeof actions)[ActionName]>)[
    action
  ];
  if (!entry) {
    return Response.json({ error: `unknown action: ${action}` }, { status: 404 });
  }
  let body: unknown = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = await req.json();
    }
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = entry.request.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await (
      entry.handler as (args: unknown) => Promise<unknown>
    )(parsed.data);
    const out = entry.response.safeParse(result);
    if (!out.success) {
      console.error(`action ${action}: response failed validation`, out.error);
      return Response.json({ error: "internal error" }, { status: 500 });
    }
    return Response.json(out.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "action failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function serveStatic(pathname: string): Promise<Response | null> {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = Bun.file(join(DIST, rel));
  if (await file.exists()) {
    return new Response(file, {
      headers: { "content-type": mimeFor(rel) },
    });
  }
  return null;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/") && req.method === "POST") {
      return handleApi(url.pathname.slice("/api/".length), req);
    }
    if (req.method === "GET") {
      const hit = await serveStatic(url.pathname);
      if (hit) return hit;
      const index = Bun.file(join(DIST, "index.html"));
      if (await index.exists()) {
        return new Response(index, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`World Radio Tuner listening on http://localhost:${PORT}`);
