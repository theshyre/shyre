# Document sign-off — 21 CFR Part 11 gap-list

The generic document sign-off (`docs/reference/database-schema.md` → "Document
sign-off") is built to **proposals-parity** signature grade. AVDR eClinical is
clinical software, so its release-notes sign-offs may eventually need full **21
CFR Part 11** electronic-signature grade. This tracks the gap so it can be
green-lit if a sponsor/QA requires it — it is **not** a claim of current Part 11
compliance.

## Already satisfied by proposals-parity

- **Unique, credentialed link + email OTP** — identity is a per-signer
  high-entropy token (sha256 at rest) plus a one-time code to the signer's
  email, with a 5-try atomic lockout and a per-browser view-session
  (`signoff_tokens`, `signoff_otp_attempt`, SAL-036/037/045/046).
- **Record–signature linking** — each `signoff_acceptances` row freezes a
  `content_snapshot` of the exact document signed and its `content_sha256`
  (§11.70 linking; §11.10(a) tamper-evidence).
- **Audit trail** — append-only `signoff_events` + `signoff_documents_history`
  (SECURITY DEFINER, no client writes), immutable acceptance rows (no
  INSERT/UPDATE/DELETE policy), send-lock freeze after send (§11.10(e)).
- **Signature manifestation, partial** — `signature_meaning`
  (author/reviewer/approver) + a typed-name signature + an attestation
  checkbox captured at signing (§11.50 meaning; §11.200 typed-name binding).

## Gaps to close for full Part 11

1. **§11.50 manifestation on the record artifact.** The Phase-2 signed-record
   PDF must render, per signer: printed name, the **date/time** of signing, and
   the **meaning** (role). The data is captured now; the human-readable
   manifested artifact is not built yet.
2. **§11.100 signature/record certification.** A one-time, signed certification
   that the org's electronic signatures are the legal equivalent of handwritten
   ones, plus a per-signing agreement statement shown at sign time. Currently
   only an attestation checkbox.
3. **§11.10(d)/(g) unique-identity assurance.** Email-OTP is "something you
   have," bound to a specific address. A sponsor may require named,
   credentialed accounts (or MFA) rather than an emailed link — an identity
   policy decision, not just code.
4. **§11.10 system validation (IQ/OQ/PQ).** Part 11 expects documented
   validation of the closed system. That is a process/QA deliverable
   (validation protocols + evidence), not a code change.
5. **§11.10(c) record retention/copy.** A durable, exportable copy of the
   signed record (the Phase-2 PDF + a JSON export of the acceptance rows +
   hash) for the retention period.

## Recommendation

Ship proposals-parity now (it is already audit-ready and defensible). Green-light
items 1 + 2 + 5 (mostly the signed-record PDF + certification/agreement text) as
the first Part-11 increment if AVDR's sponsor asks; items 3 + 4 are
policy/validation decisions that Marcus + the sponsor own, not engineering.
