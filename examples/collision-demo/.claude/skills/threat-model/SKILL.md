---
name: threat-model
description: >
  Use this skill when the user is designing a new system or changing a trust
  boundary and needs the attack surface mapped before code is written — who can
  reach what, which assumptions break under a hostile client, and what an
  attacker gains from each component they compromise. Apply it to architecture
  decisions, not to reviewing existing code for vulnerabilities.
---

# Threat modelling

Map the attack surface of a design before it becomes code.

## When to use this

A design exists on paper and someone needs to know how it fails under attack.
Explicitly not for scanning existing code — that is `security-review`.

## Procedure

1. Draw the trust boundaries first. Every arrow crossing one is a place where
   input becomes untrusted, and those are the only places that matter.
2. For each boundary, ask what the attacker controls. Not "could this be
   attacked" but "what exactly can they set, and what does the code do with it".
3. Work through spoofing, tampering, repudiation, information disclosure,
   denial of service and elevation of privilege for each component. The value of
   the checklist is that it forces categories you would not think of unprompted.
4. Rank by what the attacker gains, not by how clever the attack is. A boring
   authorisation gap that exposes every record outranks an elegant timing attack
   that leaks one bit.

## Output

One row per threat: the boundary, what the attacker controls, what they gain,
and the specific mitigation. A threat model without mitigations is a list of
worries.
