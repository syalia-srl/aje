import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { reportOf, sendReport, signature } from "../core/shop.js";
import { parseShopLink } from "../core/qr.js";

const SHOP = { url: "https://shop.example/r", host: "shop.example", key: "k".repeat(32), last4: "0001" };
const NOTICE = { kind: "card-received", amount: "1500.00 CUP", number: "51234567", account: "9200XXXXXXXX0001", plan: null };
const BODY = "El titular del telefono 51234567 le ha realizado una transferencia a la cuenta 9200XXXXXXXX0001 de 1500.00 CUP. Nro. Transaccion KW123ABCDE456";

test("a transfer to the linked card becomes a report with the bank's transaction number", () => {
  assert.deepEqual(reportOf(SHOP, NOTICE, BODY, "sms-id"), { transaction: "KW123ABCDE456", payer: "51234567", account: "9200XXXXXXXX0001", amount: "1500.00" });
  assert.equal(reportOf(SHOP, NOTICE, "El titular … sin número", "sms-id").transaction, "sms-id");
});

test("another card, another currency, another kind or no link give no report", () => {
  assert.equal(reportOf({ ...SHOP, last4: "9999" }, NOTICE, BODY, "x"), null);
  assert.equal(reportOf(SHOP, { ...NOTICE, amount: "10.00 USD" }, BODY, "x"), null);
  assert.equal(reportOf(SHOP, { ...NOTICE, kind: "line-received" }, BODY, "x"), null);
  assert.equal(reportOf(null, NOTICE, BODY, "x"), null);
});

test("the signature is HMAC-SHA256 of the time, a period and the body", async () => {
  const header = await signature("key", '{"a":1}', 1794020400);
  assert.equal(header, `t=1794020400,v1=${createHmac("sha256", "key").update('1794020400.{"a":1}').digest("hex")}`);
});

test("sending says whether the shop took the report, refused it, or should be asked later", async () => {
  const report = reportOf(SHOP, NOTICE, BODY, "x");
  const answer = (status) => async () => ({ ok: status < 300, status });
  const now = () => 1794020400000;
  assert.equal(await sendReport(SHOP, report, { fetch: answer(200), now }), "sent");
  assert.equal(await sendReport(SHOP, report, { fetch: answer(422), now }), "refused");
  assert.equal(await sendReport(SHOP, report, { fetch: answer(502), now }), "later");
  assert.equal(await sendReport(SHOP, report, { fetch: async () => { throw new Error("offline"); }, now }), "later");
});

// The same vectors pin aje-link, the shops' side, in server/python.
const LINK = JSON.parse(readFileSync(new URL("./fixtures/link-vectors.json", import.meta.url), "utf8"));

test("Ajé reads every link the shops' library makes, and refuses what it refuses", () => {
  for (const v of LINK.links) {
    const got = parseShopLink(v.text);
    if (v.error) assert.equal(got.ok, false, v.error);
    else assert.deepEqual([got.ok, got.url, got.key, got.last4], [true, new URL(v.url).href, v.key, v.last4]);
  }
});

test("Ajé signs as the shops' library verifies", async () => {
  for (const v of LINK.signatures) assert.equal(await signature(v.key, v.body, v.t), v.header);
});
