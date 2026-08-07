---
name: security-review
description: Reviews code for security issues and vulnerabilities.
---

# Security review

Look for security problems in code.

## Notes

This skill is deliberately written badly, and `skillsonar` flags it with SR009:
the description is a capability blurb ("Reviews code for…") rather than a
trigger condition ("Use when the user…").

Compare it with `threat-model` in this same collection. Both are security
skills, but `threat-model` states when to reach for it and when not to, and
names concrete concepts — trust boundaries, attack surface, architecture — that
nothing else here claims. Run `skillsonar explain security-review` and then
`skillsonar explain threat-model` to see the difference in routing vocabulary.

In a collection this small, generic words still carry some weight. Add fifty
more skills that mention "security" and "code" and SR013 fires here too: the
IDF of those terms collapses and this skill has nothing left to win on.
