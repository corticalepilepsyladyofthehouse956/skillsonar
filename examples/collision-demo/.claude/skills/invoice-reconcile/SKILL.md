---
name: invoice-reconcile
description: >
  Use this skill when the user is matching supplier invoices against purchase
  orders or bank statements and needs the discrepancies explained — wrong totals,
  duplicate billing, missing VAT numbers, or currency mismatches. Reach for this
  even when the user only says "these numbers do not add up".
---

# Invoice reconciliation

Match invoices to their source records and explain every difference.

## When to use this

Accounts-payable work: an invoice exists and something about it needs checking
against another record. Not general document extraction — that is `pdf-extract`.

## Procedure

1. Establish the matching key. Purchase-order number is the strongest; fall back
   to supplier plus date plus amount, and say when you have done so.
2. Compare line by line, not by total. Two errors that cancel out produce a
   matching total and a wrong invoice.
3. Check tax separately from net. A VAT rate applied to the wrong base is the
   most common real discrepancy and is invisible in the gross figure.
4. Report every difference with its amount and its cause. "Mismatch" is not a
   finding; "line 4 billed 12 units at the 10-unit price, £340 over" is.

## Currency handling

Never convert silently. If the invoice and the purchase order are in different
currencies, report the rate used and the date it applies to.
