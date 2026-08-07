---
name: document-parser
description: >
  Use this skill when the user needs to parse a document and extract structured
  data such as tables, text, or fields. Supports scanned and digital documents
  of any format.
---

# Document parser

Parse documents into structured records.

## When to use this

Any request to read a document file and produce machine-readable output.

## Procedure

1. Identify the container format from the file signature, not the extension.
2. Route to the appropriate decoder.
3. Normalise the output into a flat record set.

## Notes

This skill exists to demonstrate a routing collision. Its description overlaps
almost entirely with `pdf-extract`, so an agent has no reliable basis for
choosing between the two — which is exactly what `skillsonar` reports.
