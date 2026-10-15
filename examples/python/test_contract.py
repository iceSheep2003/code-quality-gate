"""User-owned acceptance contract. Uses only the Python standard library."""
import sys
import unittest
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, ElementTree
from shipping import shipping_cost


class ShippingContract(unittest.TestCase):
    def test_below_free_threshold(self):
        self.assertEqual(shipping_cost(99.99), 8)

    def test_at_free_threshold(self):
        self.assertEqual(shipping_cost(100), 0)

    def test_above_free_threshold(self):
        self.assertEqual(shipping_cost(150), 0)

    def test_express_adds_five(self):
        self.assertEqual(shipping_cost(20, express=True), 13)

    def test_express_on_free_order(self):
        self.assertEqual(shipping_cost(100, express=True), 5)

    def test_rejects_negative_total(self):
        with self.assertRaises(ValueError):
            shipping_cost(-0.01)


class JUnitResult(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.cases = []

    def startTest(self, test):
        super().startTest(test)
        self.cases.append(Element("testcase", name=test.id()))

    def addFailure(self, test, error):
        super().addFailure(test, error)
        SubElement(self.cases[-1], "failure").text = self.failures[-1][1]

    def addError(self, test, error):
        super().addError(test, error)
        SubElement(self.cases[-1], "error").text = self.errors[-1][1]

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        SubElement(self.cases[-1], "skipped", message=reason)


if __name__ == "__main__":
    result = JUnitResult()
    unittest.defaultTestLoader.loadTestsFromTestCase(ShippingContract).run(result)
    suite = Element("testsuite", tests=str(result.testsRun),
                    failures=str(len(result.failures)), errors=str(len(result.errors)),
                    skipped=str(len(result.skipped)))
    suite.extend(result.cases)
    Path(".quality").mkdir(exist_ok=True)
    ElementTree(suite).write(".quality/acceptance.xml", encoding="utf-8", xml_declaration=True)
    for _, message in result.failures + result.errors:
        print(message, file=sys.stderr)
    print(f"{result.testsRun} tests, {len(result.failures)} failures, {len(result.errors)} errors")
    sys.exit(0 if result.wasSuccessful() else 1)
