# aje-link

The receiving side of Ajé's shop link, for a shop that sells against bank transfers to one of its cards.

```bash
uv add "aje-link @ git+https://github.com/syalia-srl/aje#subdirectory=server/python"
```

```python
import aje_link

key = aje_link.new_key()                                     # keep it secret, like a password
text = aje_link.link_text("https://shop.example/aje", key, "0001")
svg = aje_link.qr_svg(text)                                  # show it to the phone that receives the transfers

# In the handler of POST https://shop.example/aje:
try:
    report = aje_link.read_report(key, request.headers.get("X-Signature"), body, last4="0001")
except aje_link.ReportError as e:
    return 400, e.code   # bad_signature, stale_signature, invalid_report or wrong_account
# report.transaction, report.payer (8 digits), report.account, report.amount_cents
```

Answer 2xx once the report is taken, 4xx for one that will never be (Ajé drops it), 5xx to have Ajé try again.
Ajé may send the same transaction twice, so take reports idempotently by `transaction`. Which order a report pays
is the shop's to decide.

The protocol is pinned by `web/test/fixtures/link-vectors.json`, read by these tests and by Ajé's.
