# QuickBooks read-first implementation — 2026-10-23

Card QBO-ADAPTER-FINANCE-ADAPTERS-20261021. Builder astra6 (gpt-6-astra/high).
Source spec: operator-supplied Intuit runbook PART 5 and PART 7.

Contract: existing FinanceAdapter remains compatible; opt-in FinanceReadAdapter adds
Accounts, Customers, Vendors, Purchases, Bills, Deposits and Payments. Invoices
remain read-only. No tax calculation, vendor auto-classification or accounting writes.
Missing configuration gates before HTTP. Examined-empty is ok([]); HTTP, OAuth,
malformed data, storage and pagination failures cannot produce that result.

Token storage is injected, encrypted by the host, and locked per tenant/app/realm/
environment. Save refresh intent before HTTP, then atomically save the full returned
pair and expiry times before using it. Interrupted rotation requires reconnect.
The host supplies a durable lock shared across processes and commits each save
before resolving it. No registry or reviewer actions in this implementation task.

Plan:
- Define additive read/result contracts and write boundary tests first.
- Implement token lifecycle, validated paginated GET reads and conservative matching.
- Add sandbox-only smoke script, storage integration instructions and source notes.
- Run tests, negative controls, typecheck, compiler lint and build; commit dist.
- Open PR against main; leave sandbox execution, review and release deferred.

Known-answer declared before execution: synthetic PP-001, invoice FPC-1001, USD
125.00 -> D-1 / P-1 / I-1 only. Duplicate candidates, absent links, changed amount
or changed currency must not match. Fixtures are invented, not client records.

## Repair r1 — B1/B2

Acceptance: identical synthetic Purchase charges/refunds must serialize differently;
Purchase EntityRef value/type/name survives, and only Vendor maps to vendorId.
Add PurchaseResult with required credit and paymentType and optional entityRef.
Amounts remain provider values on both totals and lines. Per the saved official
SDK schema, absent/null Credit means false; true requires CreditCard. Unknown or
malformed direction/payee fields fail invalid_response without partial data.

Single repair lane: add failing source/dist tests from review probes, implement
Purchase mapping and small non-blocking query/matcher guards, extend independent
mutation controls for B1/B2, rebuild dist, run all checks, update PR #1 and push.
No live Intuit requests, reviewer actions, registry writes, merge or main push.
