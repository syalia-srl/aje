// The QR tab: a camera viewfinder whose frames go to jsQR. An Ajé charge opens Enviar saldo filled in
// with its number, name and amount; the person still taps Enviar and gives the key.
import { parseCharge, parseShopLink, parseTransferQr } from "../core/qr.js";
import { h } from "./dom.js";

const MESSAGES = {
  "not-aje": "Este QR no es de Ajé ni una transferencia de Transfermóvil",
  newer: "Actualiza Ajé para leer este QR",
  bad: "Este QR de Ajé está incompleto",
  "bad-transfer": "Este QR de transferencia está incompleto",
  "bad-link": "Este QR de tienda está incompleto o no es seguro",
};
// An image is drawn with its longer side between these, so a small SVG is read as well as a large photo.
const IMAGE_MIN = 600;
const IMAGE_MAX = 1600;
const EVERY_MS = 250;

/** jsQR is a classic script, loaded once on first use. */
let reader = null;
function loadReader() {
  reader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("../vendor/qr/jsQR.js", import.meta.url).href;
    s.onload = () => resolve(globalThis.jsQR);
    s.onerror = () => { reader = null; reject(new Error("jsQR did not load")); };
    document.head.append(s);
  });
  return reader;
}

export function renderQrScan(ctx) {
  const msg = h("div", { id: "qr-msg", class: "hint" }, "Apunta al QR de Ajé de quien te pide saldo, o a un QR de transferencia de Transfermóvil.");
  const video = h("video", { class: "qrcam", playsinline: true, muted: true });
  let stream = null;
  let done = false;

  const stop = () => {
    done = true;
    stream?.getTracks().forEach((t) => t.stop());
    removeEventListener("aje-qr", onTest);
    removeEventListener("hashchange", stop);
  };
  // Leaving the tab by any route (back, the nav, a scan) closes the camera and the listeners.
  addEventListener("hashchange", stop);

  // A card reports to one shop: linking says which earlier link this one replaces.
  function replacing(shops, link) {
    const same = shops.find((s) => s.url === link.url);
    const card = shops.find((s) => s.url !== link.url && s.last4 === link.last4);
    const lines = [
      same ? `Ya avisas a ${same.host}. Vincular de nuevo cambia su clave y su tarjeta.` : null,
      card ? `La tarjeta terminada en ${link.last4} ya avisa a ${card.host}. Cada tarjeta avisa a una sola tienda: ${card.host} dejará de recibir avisos.` : null,
    ].filter(Boolean);
    return lines.length ? h("p", { class: "hint", id: "link-again" }, lines.join(" ")) : null;
  }

  // A shop's link asks before it is kept: from then on Ajé tells that shop of transfers to one card.
  function confirmLink(link) {
    root.replaceChildren(
      h("div", { class: "topbar" }, h("div", { class: "t" }, "Vincular una tienda")),
      h("div", { class: "empty", id: "link-ask" },
        h("p", {}, `¿Avisar a ${link.host} de las transferencias que lleguen a tu tarjeta terminada en ${link.last4}?`),
        h("p", { class: "hint" }, "Ajé le enviará, de cada una, el número de transacción, el móvil que pagó y el monto. Nada más, y a nadie más. Puedes quitarlo en Ajustes."),
        replacing(ctx.store.state.shops, link)),
      h("button", { id: "link-yes", class: "btn", onclick: async () => { await ctx.store.linkShop(link); ctx.go("settings"); } }, "Vincular"),
      h("button", { id: "link-no", class: "btn ghost", onclick: () => ctx.go("home") }, "Cancelar"));
  }

  function handle(text) {
    if (done) return;
    const c = parseCharge(text);
    if (!c.ok) {
      const t = parseTransferQr(text);
      if (t.ok) {
        stop();
        ctx.go(`transfer?${new URLSearchParams({ to: t.account })}`);
        return;
      }
      const link = parseShopLink(text);
      if (link.ok) {
        stop();
        confirmLink(link);
        return;
      }
      msg.textContent = MESSAGES[c.reason !== "not-aje" ? c.reason : t.reason === "bad" ? "bad-transfer" : link.reason === "not-link" ? "not-aje" : link.reason === "newer" ? "newer" : "bad-link"];
      return;
    }
    stop();
    const q = new URLSearchParams({ sub: String(ctx.sims[0]?.subId ?? ""), to: c.number });
    if (c.amount) q.set("m", String(c.amount));
    if (c.name) q.set("a", c.name);
    ctx.go(`line-transfer?${q}`);
  }

  // Under the mock, the panel and the smoke test hand over a scanned text: headless Chromium has no camera.
  const onTest = (e) => handle(e.detail);
  if (ctx.bridge.kind === "mock") addEventListener("aje-qr", onTest);

  // A QR on this phone's own screen (a shop's page, a charge sent in a chat) comes in as a screenshot.
  const file = h("input", { type: "file", id: "qr-file", accept: "image/*", class: "sr", tabindex: "-1", "aria-hidden": "true" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f || done) return;
    msg.textContent = "Leyendo la imagen…";
    const jsQR = await loadReader().catch(() => null);
    if (!jsQR) {
      msg.textContent = "Ajé no pudo cargar el lector de QR.";
      return;
    }
    const url = URL.createObjectURL(f);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w0 = img.naturalWidth || IMAGE_MIN;
      const h0 = img.naturalHeight || IMAGE_MIN;
      const k = Math.min(IMAGE_MAX / Math.max(w0, h0), Math.max(1, IMAGE_MIN / Math.max(w0, h0)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w0 * k);
      canvas.height = Math.round(h0 * k);
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.fillStyle = "#fff";
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      const code = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
      if (code?.data) handle(code.data);
      else if (!done) msg.textContent = "No encontré un QR en esa imagen.";
    } catch {
      if (!done) msg.textContent = "Ajé no pudo abrir esa imagen.";
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  async function scan() {
    // The reader first: without it the camera is never opened.
    const jsQR = await loadReader().catch(() => null);
    if (done) return;
    if (!jsQR) {
      msg.textContent = "Ajé no pudo cargar el lector de QR.";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      msg.textContent = "Ajé no puede usar la cámara. Puedes escribir el número en Enviar saldo.";
      return;
    }
    if (done) return stop();
    video.srcObject = stream;
    await video.play().catch(() => null);
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d", { willReadFrequently: true });
    const tick = () => {
      if (done) return;
      if (!root.isConnected) return stop();
      if (video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        g.drawImage(video, 0, 0);
        const code = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
        if (code?.data) handle(code.data);
      }
      setTimeout(tick, EVERY_MS);
    };
    tick();
  }

  const root = h("div", { id: "qr-scan" },
    h("div", { class: "topbar" }, h("div", { class: "t" }, "Pagar con QR")),
    h("div", { class: "qrview" }, video),
    msg,
    file,
    h("button", { id: "qr-image", class: "btn ghost", onclick: () => file.click() }, "Leer QR de una imagen"),
    h("button", { id: "qr-number", class: "btn ghost", onclick: () => { stop(); ctx.go(`line-transfer?sub=${ctx.sims[0]?.subId ?? ""}`); } },
      "Escribir el número"));
  scan();
  return root;
}
