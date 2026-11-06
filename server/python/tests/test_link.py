import json
import unittest
import urllib.parse
from pathlib import Path

import aje_link

VECTORS = json.loads((Path(__file__).parents[3] / "web/test/fixtures/link-vectors.json").read_text(encoding="utf-8"))


class LinkVectors(unittest.TestCase):
    def test_links(self):
        for v in VECTORS["links"]:
            with self.subTest(v["text"]):
                if "error" in v:
                    with self.assertRaises(ValueError):
                        aje_link.link_text(v["url"], v["key"], v["last4"])
                else:
                    self.assertEqual(aje_link.link_text(v["url"], v["key"], v["last4"]), v["text"])

    def test_signatures(self):
        for v in VECTORS["signatures"]:
            self.assertEqual(aje_link.sign(v["key"], v["body"].encode(), v["t"]), v["header"])

    def test_reports(self):
        for v in VECTORS["reports"]:
            with self.subTest(v):
                read = lambda: aje_link.read_report(VECTORS["key"], v["header"], v["body"].encode(), last4=v.get("last4"), now=v["now"])
                if "error" in v:
                    with self.assertRaises(aje_link.ReportError) as e:
                        read()
                    self.assertEqual(e.exception.code, v["error"])
                else:
                    self.assertEqual(read(), aje_link.Report(**v["report"]))


class Library(unittest.TestCase):
    def test_a_new_key_is_long_enough_and_fresh(self):
        a, b = aje_link.new_key(), aje_link.new_key()
        self.assertEqual(len(a), 43)
        self.assertNotEqual(a, b)
        text = aje_link.link_text("https://shop.example/r", a, "0001")
        self.assertEqual(urllib.parse.parse_qs(text.split("?", 1)[1])["k"], [a])

    def test_the_qr_svg_scales_with_css(self):
        svg = aje_link.qr_svg(aje_link.link_text("https://shop.example/r", "k" * 32, "0001"))
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn("viewBox", svg)
        self.assertNotIn(' width="', svg)


if __name__ == "__main__":
    unittest.main()
