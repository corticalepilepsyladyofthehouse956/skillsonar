---
name: pdf-extract
description: >
  Use this skill when the user needs to pull structured data out of a document
  file — tables, form fields, line items, or plain text. Handles scanned and
  digital documents, and works even when the user does not say which format
  they have.
---

# PDF extraction

Extract structured content from documents while preserving layout relationships.

## When to use this

The user has a document and wants data out of it. Typical phrasings include
"get the tables out of this", "what are the line items", or "turn this into a
spreadsheet".

## Procedure

1. Determine whether the document has an embedded text layer. If it does not,
   the document is scanned and needs OCR before anything else works.
2. For tabular content, detect ruling lines first and fall back to whitespace
   alignment only when no ruling lines exist.
3. Preserve the reading order of the original. Multi-column layouts must be
   segmented per column before extraction, or the output interleaves columns.
4. Emit CSV for tabular output and JSON for form fields.

## Limitations

Rotated pages and handwritten annotations are not handled. Say so explicitly
rather than returning partial data that looks complete.
