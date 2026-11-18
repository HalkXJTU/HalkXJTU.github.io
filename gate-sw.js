/* Only ciphertext lives on the server. Decrypted responses never enter Cache Storage. */
const scopeURL = new URL(self.registration.scope);
const sessions = new Map();
const handoffs = new Map();
const visitorScripts = new Set(["gate-ui.js", "gate-ui.css", "vault.js", "gate-sw.js", "gate-config.json", "invitation-grants.json", "named-invites.mjs", "robots.txt", ".nojekyll"]);
const tabLifetime = 2 * 60 * 60 * 1000;

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function base64Bytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function getBytes(url) {
  const response = await fetch(new URL(url, scopeURL), { cache: "no-store" });
  if (!response.ok) throw new Error("Unavailable encrypted resource");
  return response.arrayBuffer();
}

async function acceptKey(state) {
  if (typeof state?.key !== "string" || !Number.isFinite(state.until) || state.until <= Date.now()) {
    throw new Error("Invalid reading session");
  }
  const config = JSON.parse(new TextDecoder().decode(await getBytes("gate-config.json")));
  if (state.id !== config.id) throw new Error("The site has been updated");
  const key = await crypto.subtle.importKey("raw", base64Bytes(state.key), "AES-GCM", false, ["decrypt"]);
  const manifest = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Bytes(config.manifestIv) }, key, await getBytes("vault/manifest.bin")
  );
  return {
    key,
    files: JSON.parse(new TextDecoder().decode(manifest)),
    until: Math.min(state.until, Date.now() + tabLifetime)
  };
}

function purge() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.until <= now) sessions.delete(id);
  }
  for (const [id, handoff] of handoffs) {
    if (handoff.until <= now) handoffs.delete(id);
  }
}

function issueHandoff(path, session, clientId) {
  const token = crypto.randomUUID();
  handoffs.set(token, { path, session, clientId, until: Math.min(session.until, Date.now() + 30000) });
  return token;
}

function forget(clientId) {
  sessions.delete(clientId);
  for (const [token, item] of handoffs) {
    if (item.clientId === clientId) handoffs.delete(token);
  }
}

self.addEventListener("message", event => {
  const port = event.ports[0];
  if (!port || !event.source?.id || !event.source.url.startsWith(scopeURL.href)) return;
  event.waitUntil((async () => {
    purge();
    const data = event.data;
    const clientId = event.source.id;
    try {
      if (data.type === "vault-lock") {
        forget(clientId);
        port.postMessage({ ok: true });
      } else if (data.type === "vault-unlock") {
        const session = await acceptKey(data.state);
        const entry = data.path === "legacy.html" ? "legacy.html" : "index.html";
        sessions.set(clientId, session);
        port.postMessage({ ok: true, ticket: issueHandoff(entry, session, clientId) });
      } else if (data.type === "vault-image") {
        const session = await sessionFor(clientId);
        const entry = session && Object.hasOwn(session.files, data.path) && session.files[data.path];
        if (!entry || !entry.type.startsWith("image/")) throw new Error("Unavailable image");
        port.postMessage({ ok: true, ticket: issueHandoff(data.path, session, clientId) });
      }
    } catch {
      port.postMessage({ ok: false });
    }
  })());
});

const recovering = new Map();
async function sessionFor(clientId) {
  if (!clientId) return null;
  if (sessions.has(clientId)) return sessions.get(clientId);
  if (recovering.has(clientId)) return recovering.get(clientId);
  // Browsers can stop a worker between two requests. Only ask the actual requesting tab.
  const recovery = (async () => {
    const client = await self.clients.get(clientId);
    if (!client || !client.url.startsWith(scopeURL.href)) return null;
    const channel = new MessageChannel();
    const state = await new Promise(resolve => {
      const timeout = setTimeout(() => resolve(null), 1500);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);
        resolve(event.data);
      };
      client.postMessage({ type: "vault-session-request" }, [channel.port2]);
    });
    channel.port1.close();
    if (!state) return null;
    const session = await acceptKey(state);
    sessions.set(clientId, session);
    return session;
  })().catch(() => null);
  recovering.set(clientId, recovery);
  try { return await recovery; }
  finally { recovering.delete(clientId); }
}

function errorResponse(status) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

async function gateDocument() {
  // Even a nested image URL should load the gate and its scripts at the site's root.
  const gate = await fetch(new URL("index.html", scopeURL), { cache: "no-store" });
  const markup = (await gate.text()).replace(/<head\b[^>]*>/i, match => match + '<base href="' + scopeURL.pathname + '">');
  return new Response(markup, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function returnToGate(event) {
  for (const id of [event.clientId, event.replacesClientId, event.resultingClientId]) {
    if (id) forget(id);
  }
  return gateDocument();
}

async function serve(event, url, path) {
  purge();
  const navigating = event.request.mode === "navigate";
  if (navigating && url.searchParams.has("__lock")) {
    return returnToGate(event);
  }
  const ticket = url.searchParams.get("__entry");
  let session;
  if (navigating && ticket && handoffs.has(ticket)) {
    const item = handoffs.get(ticket);
    if (item.path === path) {
      session = item.session;
      handoffs.delete(ticket);
    }
  }
  if (!session) session = await sessionFor(event.clientId || event.replacesClientId);
  if (!session || session.until <= Date.now()) {
    if (navigating) return gateDocument();
    return errorResponse(403);
  }
  if (!Object.hasOwn(session.files, path)) return errorResponse(404);
  const entry = session.files[path];
  let body;
  try {
    body = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64Bytes(entry.iv) }, session.key, await getBytes(entry.file)
    );
  } catch {
    if (!navigating) return errorResponse(503);
    // A new Pages release may have replaced all of the previous release's ciphertext.
    return returnToGate(event);
  }
  if (navigating && event.resultingClientId && entry.type.startsWith("text/html")) {
    sessions.set(event.resultingClientId, session);
  }
  return new Response(event.request.method === "HEAD" ? null : body, {
    headers: { "Content-Type": entry.type, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" }
  });
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== scopeURL.origin || !url.pathname.startsWith(scopeURL.pathname)) return;
  if (scopeURL.origin === "http://127.0.0.1:4173" && url.pathname === "/access/unlock" && event.request.method === "POST") return;
  if (url.pathname.startsWith("/access/") || url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    event.respondWith(errorResponse(404));
    return;
  }
  let path;
  try { path = decodeURIComponent(url.pathname.slice(scopeURL.pathname.length)) || "index.html"; }
  catch { event.respondWith(errorResponse(400)); return; }
  if (visitorScripts.has(path) || path.startsWith("vault/")) return;
  if (!["GET", "HEAD"].includes(event.request.method)) {
    event.respondWith(errorResponse(405));
    return;
  }
  event.respondWith(serve(event, url, path).catch(() => errorResponse(503)));
});
