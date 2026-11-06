// A shop the person linked with its QR (qr.js parseShopLink) sells against transfers to one of their cards.
// When the bank's SMS says a transfer reached that card, Ajé posts it to the shop, signed with the link's key:
// `X-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of t, a period and the body>`. That is all that leaves the
// phone, and only to that shop.
import { last4 } from "./money.js";

const TRANSACTION = /Nro\.?\s*Transacci[oó]n:?\s*([A-Z0-9]+)/i;

/**
 * What a received transfer tells the shop, or null when it is not for the linked card or not in CUP.
 * `id` names the SMS when the bank's text carries no transaction number.
 */
export function reportOf(shop, notice, body, id) {
  if (!shop || notice?.kind !== "card-received" || !notice.account || last4(notice.account) !== shop.last4) return null;
  const [amount, currency] = notice.amount.split(" ");
  if (currency !== "CUP") return null;
  return { transaction: TRANSACTION.exec(body)?.[1] ?? id, payer: notice.number, account: notice.account, amount };
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The X-Signature header for `body` at `seconds`. */
export async function signature(key, body, seconds) {
  const subtle = globalThis.crypto.subtle;
  const k = await subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await subtle.sign("HMAC", k, new TextEncoder().encode(`${seconds}.${body}`));
  return `t=${seconds},v1=${hex(mac)}`;
}

/**
 * Posts one report. "sent" when the shop took it, "refused" when it answered that it never will (a 4xx: a
 * wrong key or another account), "later" when the network or the shop failed and it should be tried again.
 */
export async function sendReport(shop, report, { fetch, now }) {
  const body = JSON.stringify(report);
  try {
    const r = await fetch(shop.url, {
      method: "POST", body,
      headers: { "Content-Type": "application/json", "X-Signature": await signature(shop.key, body, Math.floor(now() / 1000)) },
    });
    if (r.ok) return "sent";
    return r.status >= 400 && r.status < 500 ? "refused" : "later";
  } catch {
    return "later";
  }
}
