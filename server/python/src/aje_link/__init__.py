"""The receiving side of Ajé's shop link.

A shop shows a QR with `link_text`; the phone that receives its transfers scans it with Ajé. From then on, for each
transfer in CUP to that card, Ajé posts a JSON report to the shop's url, signed with the link's key in the
`X-Signature` header. `read_report` turns that request into a verified `Report`. Which order a report pays is the
shop's to decide. The protocol is pinned by `web/test/fixtures/link-vectors.json`, which Ajé's own tests read too.
"""

import base64
import hashlib
import hmac
import io
import json
import re
import secrets
import time
import urllib.parse
from dataclasses import dataclass

__all__ = ["Report", "ReportError", "link_text", "new_key", "qr_svg", "read_report", "sign"]

VERSION = 1
MIN_KEY = 16
MAX_SKEW = 300
PHONE = re.compile(r"^5\d{7}$")


@dataclass(frozen=True)
class Report:
    transaction: str  # The bank's transaction number, or Ajé's id of the SMS when the text has none.
    payer: str  # The paying line, eight digits.
    account: str  # The receiving account as the SMS writes it, often masked; its last four digits are real.
    amount_cents: int


class ReportError(ValueError):
    """A request that is not a report to take: `code` is bad_signature, stale_signature, invalid_report or wrong_account."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def new_key() -> str:
    """A fresh link key: 32 random bytes, base64url without padding."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()


def link_text(url: str, key: str, last4: str) -> str:
    """The text of the link QR, held to the rules Ajé applies when it scans one."""
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("the url must be https")
    if len(key) < MIN_KEY:
        raise ValueError(f"the key must have at least {MIN_KEY} characters")
    if not re.fullmatch(r"\d{4}", last4):
        raise ValueError("last4 must be four digits")
    return "aje:aviso?" + urllib.parse.urlencode({"v": str(VERSION), "u": url, "k": key, "c": last4})


def qr_svg(text: str) -> str:
    """The QR of `text` as an SVG element for a page: a viewBox and no fixed size, so CSS sizes it."""
    import segno

    out = io.BytesIO()
    segno.make(text, error="m").save(out, kind="svg", scale=6, border=2, dark="#0B0B12", light="#FFFFFF",
                                     xmldecl=False, omitsize=True)
    return out.getvalue().decode()


def sign(key: str, body: bytes, t: int) -> str:
    """The `X-Signature` header Ajé sends with `body` at unix time `t`; for a shop's own tests."""
    return f"t={t},v1={hmac.new(key.encode(), f'{t}.'.encode() + body, hashlib.sha256).hexdigest()}"


def read_report(key: str, header: str | None, body: bytes, last4: str | None = None, now: float | None = None,
                max_skew: int = MAX_SKEW) -> Report:
    """The report in a request Ajé sent, after checking its signature, its age and, with `last4`, its account."""
    parts = dict(p.split("=", 1) for p in (header or "").split(",") if "=" in p)
    t, v1 = parts.get("t", ""), parts.get("v1", "")
    if not (t.isascii() and t.isdigit() and v1):
        raise ReportError("bad_signature")
    if not hmac.compare_digest(sign(key, body, int(t)).encode(), f"t={t},v1={v1}".encode()):
        raise ReportError("bad_signature")
    if abs((time.time() if now is None else now) - int(t)) > max_skew:
        raise ReportError("stale_signature")
    try:
        found = json.loads(body)
        transaction, account = str(found["transaction"]), str(found["account"])
        payer = re.sub(r"\D", "", str(found["payer"]))
        cents = round(float(found["amount"]) * 100)
    except (ValueError, KeyError, TypeError):
        raise ReportError("invalid_report") from None
    if len(payer) == 10 and payer.startswith("53"):
        payer = payer[2:]
    if not (transaction and PHONE.match(payer) and cents > 0 and re.fullmatch(r"\d{4}", account[-4:])):
        raise ReportError("invalid_report")
    if last4 is not None and account[-4:] != last4:
        raise ReportError("wrong_account")
    return Report(transaction=transaction, payer=payer, account=account, amount_cents=cents)
