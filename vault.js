(() => {
  "use strict";
  const scope = new URL("./", document.currentScript.src);
  const storageName = "private-reading:" + scope.pathname;
  const lifetime = 2 * 60 * 60 * 1000;
  const previewOrigin = "http://127.0.0.1:4173";
  const inviteFormat = /^INV-[A-Za-z0-9_-]{22}$/;
  const encoder = new TextEncoder();
  const gate = Boolean(document.querySelector('script[src*="gate-ui.js"]'));
  const canDecrypt = window.isSecureContext && Boolean(window.crypto?.subtle) && /^https?:$/.test(location.protocol);
  const decoder = new TextDecoder();
  let submitting = false;
  let locking = false;
  let configRequest;
  let memoryState = null;
  let attempt = null;
  let service;
  try { service = navigator.serviceWorker; } catch { /* Sandboxed browsers can disable workers. */ }

  function bytes(value) {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
  }
  function currentState() {
    let state = memoryState;
    try { state = JSON.parse(sessionStorage.getItem(storageName)); } catch { /* Optional storage. */ }
    return state?.until > Date.now() ? state : null;
  }
  function remember(state) {
    memoryState = state;
    try {
      if (state) sessionStorage.setItem(storageName, JSON.stringify(state));
      else sessionStorage.removeItem(storageName);
    } catch { /* The current read can still use the key in memory. */ }
  }
  async function resource(path) {
    const response = await fetch(new URL(path, scope), { cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("Unavailable encrypted resource");
    return response;
  }
  function config() {
    configRequest ??= resource("gate-config.json").then(response => response.json()).catch(error => {
      configRequest = null;
      throw error;
    });
    return configRequest;
  }
  async function decrypt(key, iv, ciphertext) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv) }, key, ciphertext);
  }
  async function previewGrant(code, settings) {
    // Reuse the receipt on a retry when the server may already have counted
    // this tab's grant. Neither the code nor the receipt is saved in storage.
    if (!attempt || attempt.code !== code || attempt.release !== settings.id) {
      attempt = { code, release: settings.id, visit: crypto.randomUUID() };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(new URL("/access/unlock", scope), {
        method: "POST", mode: "cors", credentials: "omit", redirect: "error",
        cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt)
      });
      if (response.status === 401 || response.status === 403) throw new Error("wrong");
      if (response.status === 429) throw new Error("limited");
      if (response.status === 409) throw new Error("updated");
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("unavailable");
      const grant = await response.json();
      if (grant.id !== settings.id) throw new Error("updated");
      if (typeof grant.key !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(grant.key)) throw new Error("unavailable");
      return { id: grant.id, key: grant.key, until: Date.now() + lifetime };
    } finally { clearTimeout(timer); }
  }
  function digest(domain, code) {
    return crypto.subtle.digest("SHA-256", encoder.encode(domain + ":v1:" + code));
  }
  function base64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }
  async function readGrant(code, settings) {
    if (scope.origin === previewOrigin && !settings.inviteGrants && !settings.accessEndpoint) {
      if (!inviteFormat.test(code) && !/^\d{4}$/.test(code)) throw new Error("wrong");
      return { state: await previewGrant(code, settings) };
    }
    if (!inviteFormat.test(code)) throw new Error("wrong");
    if (settings.inviteGrants !== "invitation-grants.json") throw new Error("unavailable");
    const table = await (await resource(settings.inviteGrants)).json();
    if (table.version !== 1 || table.release !== settings.id) throw new Error("updated");
    const id = Array.from(new Uint8Array(await digest("id", code), 0, 16),
      byte => byte.toString(16).padStart(2, "0")).join("");
    const grant = table.grants?.[id];
    if (!grant) throw new Error("wrong");
    const wrap = await crypto.subtle.importKey("raw", await digest("wrap", code), "AES-GCM", false, ["decrypt"]);
    const raw = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: bytes(grant.iv), additionalData: encoder.encode(id + "." + settings.id)
    }, wrap, bytes(grant.wrapped));
    if (raw.byteLength !== 32) throw new Error("unavailable");
    const receipt = base64(await digest("count", code)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    return { state: { id: settings.id, key: base64(raw), until: Date.now() + lifetime }, receipt };
  }

  const queuePrefix = "homepage-visit:" + scope.pathname + ":";
  const pending = new Map();
  const visitLifetime = 24 * 60 * 60 * 1000;
  let flushing = false;
  function forgetVisit(visit) {
    pending.delete(visit);
    try { localStorage.removeItem(queuePrefix + visit); } catch { /* Memory-only queue. */ }
  }
  function queuedVisits() {
    const records = new Map(pending);
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(queuePrefix)) continue;
        const visit = key.slice(queuePrefix.length);
        try { records.set(visit, JSON.parse(localStorage.getItem(key))); } catch { forgetVisit(visit); }
      }
    } catch { /* Private browsing can disable local storage. */ }
    const entries = [];
    const now = Date.now();
    for (const [visit, record] of records) {
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(visit) ||
          !/^[\w-]{43}$/.test(record?.receipt) || !Number.isFinite(record?.time) ||
          record.time > now || now - record.time >= visitLifetime) {
        forgetVisit(visit);
      } else entries.push([visit, record]);
    }
    entries.sort((a, b) => a[1].time - b[1].time);
    for (const [visit] of entries.splice(0, Math.max(0, entries.length - 64))) forgetVisit(visit);
    return entries;
  }
  async function flushVisits() {
    if (flushing) return;
    const entries = queuedVisits();
    if (!entries.length || navigator.onLine === false) return;
    flushing = true;
    try {
      const settings = await config();
      if (!settings.statsEndpoint || settings.inviteGrants !== "invitation-grants.json") return;
      const endpoint = new URL(settings.statsEndpoint);
      if (endpoint.protocol !== "https:" || endpoint.pathname !== "/access/visits" ||
          endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return;
      for (const [visit, {receipt}] of entries) {
        const response = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({receipt, visit}),
          mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
          keepalive: true, signal: AbortSignal.timeout(8000)
        });
        if (response.ok || [400, 403, 410].includes(response.status)) forgetVisit(visit);
        else break;
      }
    } catch { /* Resume the same visit IDs when online or on the next page. */ }
    finally { flushing = false; }
  }
  function recordVisit(receipt) {
    const visit = crypto.randomUUID();
    const record = { receipt, time: Date.now() };
    try { localStorage.setItem(queuePrefix + visit, JSON.stringify(record)); }
    catch { pending.set(visit, record); }
    void flushVisits();
  }
  addEventListener("online", flushVisits);
  addEventListener("pageshow", flushVisits);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushVisits();
  });
  void flushVisits();
  function exchange(worker, message, timeout = 6000) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error("Worker unavailable"));
      }, timeout);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        channel.port1.close();
        if (event.data?.ok) resolve(event.data);
        else reject(new Error("Worker declined request"));
      };
      worker.postMessage(message, [channel.port2]);
    });
  }
  function isOurWorker(worker) {
    return worker?.scriptURL === new URL("gate-sw.js", scope).href;
  }
  function relativeFile(value, base = scope) {
    if (!value || value.startsWith("#")) return null;
    const url = new URL(value, base);
    return url.origin === scope.origin && url.pathname.startsWith(scope.pathname)
      ? decodeURIComponent(url.pathname.slice(scope.pathname.length)) : null;
  }
  function currentEntry() {
    return relativeFile(location.href) === "legacy.html" ? "legacy.html" : "index.html";
  }
  function destination() {
    const url = new URL(location.href);
    url.searchParams.delete("__entry");
    const language = window.gateUI?.language;
    if (["zh", "en", "it"].includes(language)) url.searchParams.set("lang", language);
    return url;
  }

  if (service) {
    service.addEventListener("message", event => {
      if (event.data?.type === "vault-session-request" && isOurWorker(event.source)) {
        event.ports[0]?.postMessage(currentState());
      }
    });
  }

  async function controlledWorker() {
    if (!service) return null;
    if (isOurWorker(service.controller)) return service.controller;
    return new Promise(resolve => {
      const finish = worker => {
        clearTimeout(timer);
        service.removeEventListener("controllerchange", changed);
        resolve(worker);
      };
      const changed = () => {
        if (isOurWorker(service.controller)) finish(service.controller);
      };
      const timer = setTimeout(() => finish(null), 2200);
      service.addEventListener("controllerchange", changed);
      service.register(new URL("gate-sw.js", scope), { scope: scope.pathname, updateViaCache: "none" })
        .then(changed, () => finish(null));
    });
  }

  async function lock() {
    if (locking) return;
    locking = true;
    document.documentElement.style.visibility = "hidden";
    remember(null);
    const worker = service?.controller;
    if (isOurWorker(worker)) {
      try { await exchange(worker, { type: "vault-lock" }, 500); } catch { /* The navigation also revokes access. */ }
    }
    const url = new URL(currentEntry(), scope);
    url.search = location.search;
    url.searchParams.delete("__entry");
    // Changing the query forces a document navigation even if the current URL has a fragment.
    url.searchParams.set("__lock", "1");
    url.hash = location.hash;
    location.replace(url);
  }

  // A published image link should open at its normal size in a separate tab. Only that
  // individual image gets a short-lived handoff; another browser cannot use the URL.
  function installImageLinks() {
    function openImage(event) {
      if (event.defaultPrevented || (event.type === "click" ? event.button !== 0 : event.button !== 1)) return;
      const link = event.target.closest?.("a.pub-image-link");
      if (!link) return;
      const path = relativeFile(link.href);
      if (!path) return;
      const worker = service?.controller;
      const vault = window.privateReadingAssets;
      if (!vault && !isOurWorker(worker)) return;
      const preview = window.open("about:blank", "_blank");
      if (!preview) return;
      event.preventDefault();
      preview.opener = null;
      const url = new URL(link.href);
      const imageURL = vault ? vault(path) : exchange(worker, { type: "vault-image", path }).then(reply => {
        url.searchParams.set("__entry", reply.ticket);
        return url.href;
      });
      imageURL.then(href => preview.location.replace(href)).catch(() => preview.close());
    }
    document.addEventListener("click", openImage);
    document.addEventListener("auxclick", openImage);
  }

  if (!gate) {
    const here = new URL(location.href);
    if (here.searchParams.has("__entry")) {
      here.searchParams.delete("__entry");
      history.replaceState(null, "", here);
    }
    window.lockSite = lock;
    document.addEventListener("click", event => {
      if (event.target.closest?.("[data-lock-site]")) {
        event.preventDefault();
        lock();
      }
    });
    installImageLinks();
    const state = currentState();
    if (state) setTimeout(lock, Math.max(0, state.until - Date.now()));
    addEventListener("pagehide", event => {
      if (event.persisted) document.documentElement.style.visibility = "hidden";
    });
    addEventListener("pageshow", event => {
      if (!event.persisted) return;
      locking = false;
      if (!currentState()) lock();
      else document.documentElement.style.removeProperty("visibility");
    });
    return;
  }

  // Embedded browsers sometimes disable service workers while still supporting WebCrypto.
  // Render the same HTML locally using temporary blob URLs in that case.
  async function materialize(state, settings, path, url, animate, onOpened) {
    const key = await crypto.subtle.importKey("raw", bytes(state.key), "AES-GCM", false, ["decrypt"]);
    async function read(file, iv) {
      return decrypt(key, iv, await (await resource(file)).arrayBuffer());
    }
    const files = JSON.parse(decoder.decode(await read("vault/manifest.bin", settings.manifestIv)));
    const blobs = new Map();
    async function blobFor(name) {
      if (!Object.hasOwn(files, name)) throw new Error("File not in the encrypted site");
      if (!blobs.has(name)) {
        const entry = files[name];
        const task = read(entry.file, entry.iv).then(async data => {
          if (entry.type.startsWith("text/css")) {
            let css = decoder.decode(data);
            const cssURLs = [...css.matchAll(/url\(\s*["']?([^)'"]+)["']?\s*\)/g)];
            for (const match of cssURLs) {
              const dependency = relativeFile(match[1].trim(), new URL(name, scope));
              if (dependency && Object.hasOwn(files, dependency)) css = css.replace(match[0], 'url("' + await blobFor(dependency) + '")');
            }
            data = css;
          }
          return URL.createObjectURL(new Blob([data], { type: entry.type }));
        }).catch(error => { blobs.delete(name); throw error; });
        blobs.set(name, task);
      }
      return blobs.get(name);
    }
    const entry = files[path];
    const markup = decoder.decode(await read(entry.file, entry.iv));
    // Mask resource attributes before parsing so the inert document makes no plaintext requests.
    const masked = markup.replace(/\s(srcset|src|href)=(["'])/gi, " data-vault-$1=$2");
    const page = new DOMParser().parseFromString(masked, "text/html");
    const elements = [...page.querySelectorAll("[data-vault-href], [data-vault-src], [data-vault-srcset]")];
    await Promise.all(elements.map(async element => {
      for (const attribute of ["href", "src", "srcset"]) {
        const maskedName = "data-vault-" + attribute;
        if (!element.hasAttribute(maskedName)) continue;
        let value = element.getAttribute(maskedName);
        if (attribute === "srcset") {
          const choices = value.split(",").map(async choice => {
            const [source, descriptor] = choice.trim().split(/\s+/);
            const name = relativeFile(source);
            return [name && Object.hasOwn(files, name) ? await blobFor(name) : source, descriptor].filter(Boolean).join(" ");
          });
          value = (await Promise.all(choices)).join(", ");
        } else if (element.tagName !== "A") {
          const name = relativeFile(value);
          if (name && Object.hasOwn(files, name)) value = await blobFor(name);
        }
        element.removeAttribute(maskedName);
        element.setAttribute(attribute, value);
      }
    }));
    if (animate) await window.gateUI.opened();
    history.replaceState(null, "", url);
    window.privateReadingAssets = blobFor;
    onOpened?.();
    document.open();
    document.write("<!doctype html>\n" + page.documentElement.outerHTML);
    document.close();
  }

  async function openSite(state, settings, animate, onOpened) {
    const url = destination();
    const path = currentEntry();
    if (!["", "index.html", "legacy.html"].includes(relativeFile(url.href))) url.pathname = new URL(path, scope).pathname;
    const worker = await controlledWorker().catch(() => null);
    if (worker) {
      let reply;
      try { reply = await exchange(worker, { type: "vault-unlock", state, path }); } catch { /* Use blob rendering. */ }
      if (reply) {
        if (animate) await window.gateUI.opened();
        url.searchParams.set("__entry", reply.ticket);
        onOpened?.();
        location.replace(url);
        return;
      }
    }
    await materialize(state, settings, path, url, animate, onOpened);
  }
  window.unlockSite = async value => {
    if (submitting) return;
    if (!canDecrypt) { window.gateUI.error("unsupported"); return; }
    const code = value.trim();
    if (!code) { window.gateUI.error("empty"); return; }
    submitting = true;
    window.gateUI.busy(true);
    try {
      const settings = await config();
      const { state, receipt } = await readGrant(code, settings);
      remember(state);
      await openSite(state, settings, true, receipt ? () => recordVisit(receipt) : undefined);
      attempt = null;
    } catch (error) {
      if (error.message === "wrong" || error.message === "updated") attempt = null;
      if (error.message === "updated") configRequest = null;
      remember(null);
      window.gateUI.busy(false);
      window.gateUI.error(["wrong", "limited", "updated", "unavailable"].includes(error.message) ? error.message : "network");
    } finally { submitting = false; }
  };
  const gateURL = new URL(location.href);
  if (gateURL.searchParams.has("__lock")) {
    remember(null);
    gateURL.searchParams.delete("__lock");
    history.replaceState(null, "", gateURL);
  }
  const saved = currentState();
  if (saved && canDecrypt) {
    submitting = true;
    window.gateUI.busy(true);
    config().then(settings => {
      if (settings.id !== saved.id) throw new Error("Updated site");
      return openSite(saved, settings, false);
    }).catch(() => { remember(null); window.gateUI.busy(false); })
      .finally(() => { submitting = false; });
  }
})();
