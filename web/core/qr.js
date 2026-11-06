// The QR of a charge between Cubacel lines: aje:saldo?v=1&n=5XXXXXXX&m=150&a=Ana. It carries no key,
// signature or secret: someone holding another person's QR can only pay that person.
import { normalizeNumber } from "./lines.js";

const VERSION = 1;
const NAME_MAX = 40;
const PREFIX = "aje:saldo?";

/** The QR text for a charge to `number`, with an optional whole-CUP amount and name. */
export function chargeUri({ number, amount = null, name = null }) {
  const q = new URLSearchParams({ v: String(VERSION), n: number });
  if (amount !== null) q.set("m", String(amount));
  if (name) q.set("a", [...name.trim()].slice(0, NAME_MAX).join(""));
  // URLSearchParams writes a space as "+"; %20 reads the same and is what other readers expect.
  return PREFIX + q.toString().replaceAll("+", "%20");
}

/** A scanned text as a charge, or why it cannot be paid: not an Ajé charge, a newer format, or malformed. */
export function parseCharge(text) {
  if (!text.startsWith(PREFIX)) return { ok: false, reason: "not-aje" };
  const q = new URLSearchParams(text.slice(PREFIX.length));
  const v = Number(q.get("v"));
  if (!Number.isInteger(v) || v < 1) return { ok: false, reason: "bad" };
  if (v > VERSION) return { ok: false, reason: "newer" };
  const number = normalizeNumber(q.get("n") ?? "");
  if (!number || number !== q.get("n")) return { ok: false, reason: "bad" };
  let amount = null;
  if (q.has("m")) {
    // Whole CUP, at most six digits: more than any balance transfer carries.
    if (!/^\d{1,6}$/.test(q.get("m")) || Number(q.get("m")) <= 0) return { ok: false, reason: "bad" };
    amount = Number(q.get("m"));
  }
  // Format and control characters go, so a name cannot reorder itself to look like another number.
  const clean = (q.get("a") ?? "").replace(/[\p{Cf}\p{Cc}]/gu, "").trim();
  const name = clean ? [...clean].slice(0, NAME_MAX).join("") : null;
  return { ok: true, number, amount, name };
}

const TRANSFER_TAG = "TRANSFERMOVIL_ETECSA,TRANSFERENCIA,";

/**
 * Transfermóvil's transfer QR, TRANSFERMOVIL_ETECSA,TRANSFERENCIA,<account>[,<phone>], as the account to pay
 * and the line to confirm. It carries no amount: the person types it.
 */
export function parseTransferQr(text) {
  if (!text.startsWith(TRANSFER_TAG)) return { ok: false, reason: "not-transfer" };
  const [account, phone = ""] = text.slice(TRANSFER_TAG.length).split(",");
  if (!/^\d{16}$/.test(account)) return { ok: false, reason: "bad" };
  const line = /^\d{10}$/.test(phone) ? phone.slice(2) : phone;
  return { ok: true, account, phone: /^\d{8}$/.test(line) ? line : null };
}

const LINK_PREFIX = "aje:aviso?";
const LINK_VERSION = 1;

/**
 * A shop's link: where Ajé reports the transfers that reach one card, the key it signs them with, and the
 * card's last four digits. Only an https address is accepted, so a report never travels in the clear.
 */
export function parseShopLink(text) {
  if (!text.startsWith(LINK_PREFIX)) return { ok: false, reason: "not-link" };
  const q = new URLSearchParams(text.slice(LINK_PREFIX.length));
  const v = Number(q.get("v"));
  if (!Number.isInteger(v) || v < 1) return { ok: false, reason: "bad" };
  if (v > LINK_VERSION) return { ok: false, reason: "newer" };
  let url;
  try {
    url = new URL(q.get("u") ?? "");
  } catch {
    return { ok: false, reason: "bad" };
  }
  const key = q.get("k") ?? "";
  const last4 = q.get("c") ?? "";
  if (url.protocol !== "https:" || key.length < 16 || !/^\d{4}$/.test(last4)) return { ok: false, reason: "bad" };
  return { ok: true, url: url.href, host: url.host, key, last4 };
}
