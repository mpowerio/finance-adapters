# QuickBooks adapter verification — 2026-10-23

## Repair r1 — B1/B2

Repair baseline: `39d7abd95001a858129d35b25a3e6b677ddd85dc`. Builder identity:
astra6 / gpt-6-astra high. Read the entire supplied REVIEW-r1.md and probes.mjs,
including non-blocking notes, current Intuit facts and token/failure results.
No reviewer selected, briefed, run or recorded by this repair; no registry writes.

- **B1:** exported `PurchaseResult` requires `credit` and `paymentType`.
  Identical USD 125 charge/refund inputs produce distinct serialized output,
  differing only at `credit`. Both totals and lines keep provider amounts.
  Missing/null Credit follows the official charge default; malformed flags,
  unknown/missing payment types and non-card credits fail `invalid_response`.
- **B2:** `entityRef` preserves Purchase EntityRef value/type/name. Vendor maps
  to vendorId; Customer and Employee keep their own type without vendorId.
  Missing optional payees remain absent, malformed/unsupported references fail
  without partial output. Stray VendorRef/CustomerRef cannot override the payee;
  Bill VendorRef behavior is unchanged. The original Purchase fixture is corrected.
- Small non-blocking repairs: duplicate PayPal references return ambiguous,
  inconsistent unpaid invoice evidence returns unmatched pending refresh,
  contradictory empty-query counts and unexpected entity keys fail loudly.
  README documents the provider's unpinned minor-version default from saved docs.

Fresh commands and results:

| Command | Result |
| --- | --- |
| `npm test -- src/quickbooks-review.test.ts --reporter=json --outputFile=.verification/repair-r1/before.json` before implementation | 56 failed / 26 passed; B1/B2 and hardening probes fail in both source and baseline committed dist |
| `npm run build` | Exit 0; committed dist rebuilt |
| `npm test -- src/quickbooks-review.test.ts --reporter=json --outputFile=.verification/repair-r1/after.json` | 82 passed / 0 failed |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0; strict compiler lint and script syntax checks |
| `npm test -- --reporter=json --outputFile=.verification/repair-r1/all-tests.json` | 179 passed / 0 failed, five files |
| `npm run test:quickbooks:negative` | All 5 mutations caught; details below |
| `git diff --check` | Exit 0 |

Committed `src/quickbooks-review.test.ts` converts the review probes into
regression assertions against source and shipped dist: output bytes, three payee
types, validation/defaults, Bill compatibility, nine reads × six HTTP failures
plus invalid_grant (63 failure controls per implementation), examined-empty,
write-disabled/no-fetch, scope, query metadata, exact matching, fees/splits,
duplicates and adjacent dates. The 97 preexisting tests also pass.

Negative controls mutate disposable copies inside the repository's ignored
node_modules cache; production source/dist remain untouched:

| Deliberate regression | Named assertion caught | Failed tests |
| --- | --- | --- |
| Remove Purchase credit/paymentType output (B1) | keeps charge and refund output bytes distinguishable | 7 |
| Bypass Purchase EntityRef mapping (B2) | preserves typed Purchase payee Vendor in output bytes | 10 |
| Expired token becomes empty success | distinguishes examined-empty from expired authentication | 32 |
| Discard refresh rotation | saves rotation and both expiries before the read | 2 |
| Pick first duplicate deposit | does not guess with duplicate deposits | 2 |

Local raw reports: `.verification/repair-r1/` and
`.verification/negative-controls/results.json`; those ignored reports are
supplemental to the committed executable tests and this receipt. No E6/E21
scripts exist in this repository (`rg --files` filename scan).

Provider facts were checked against the review's saved official IPPPurchase.php,
Purchase schema and minor-version guide in
`~/agent-out/qbo-adapter-20261023/review-r1-evidence/public-intuit-docs/`.
No new network call to Intuit or real credential use occurred. Actual sandbox
Purchase/Deposit shapes, PayPal linkage, encrypted host storage/distributed
locking, reconnect UI, scheduler and CDC/deletions remain unconfirmed integration
work. Matcher dates are not settlement proof; offset queries are not a consistent
snapshot. Dependency advisory counts below are historical, not re-audited here.

## Original build evidence (before repair r1)

Builder: astra6 / gpt-6-astra high. Card: QBO-ADAPTER-FINANCE-ADAPTERS-20261021.
Base: `b6e489ec42de9c650e41fae47398bc2b0728ef86` (`origin/main`).
All implementation work in `/tmp/finance-adapters-qbo`, branch
`feat/quickbooks-adapter-20261023`. No reviewer selected, run, briefed or recorded.
No registry writes, merge, account creation, real credentials, sandbox execution,
or Intuit production API calls. Public documentation requests only.

## Executed evidence

- Initial test-first check: `npm test -- src/quickbooks.test.ts` failed because
  `quickbooks.js` did not exist. Implementation followed that failure.
- `npm test`: **97 passed / 0 failed**, four test files. Includes 81 QuickBooks
  cases and the original 16 FreshBooks/artifact/registry cases.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0. This is explicit strict TypeScript compiler lint
  (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
  `noImplicitReturns`); the base repository had no lint script or ESLint setup.
- `npm run build`: exit 0. Committed JS/declarations/maps rebuilt with TypeScript.
- Compiled `dist/index.js` runtime import: accounting scope, exported matching
  function, mocked successful-empty read, and write-disabled/no-HTTP assertion
  passed in Node 24.15.0.
- `npm run test:quickbooks:negative`: all three deliberate defects caught in
  copies under ignored `node_modules/.cache/quickbooks-negative-controls/`.
  The real source is never modified by this command.
- `node --check scripts/quickbooks-smoke.mjs`: exit 0.
- `node scripts/quickbooks-smoke.mjs`: expected exit 1 before HTTP because
  `--sandbox` is absent.
- Same script with `--sandbox` and an empty environment: expected exit 1 for
  missing `QUICKBOOKS_SANDBOX_REALM_ID`, before HTTP.
- `npm pack --dry-run --json`: package includes the built QuickBooks exports.
- `git diff --check`: clean. `package-lock.json` unchanged from `origin/main`.
- No repository E6/E21 evaluation scripts exist; the requested assessment is in
  the PR body and builder handoff.

## Known answer and negative controls

Declared before running: synthetic `PP-001`, invoice `FPC-1001`, USD 125.00,
QBO customer `C-1` must yield exactly deposit `D-1`, payment `P-1`, invoice `I-1`.
Both direct matcher tests and mocked adapter reads produced this exact result.

| Deliberate defect | Test that failed as required |
| --- | --- |
| Convert reconnect failures into a well-formed `ok([])` | distinguishes examined-empty from expired authentication |
| Keep the old refresh token after a successful rotation | saves rotation and both expiries before the read |
| Return the first duplicate deposit match | does not guess with duplicate deposits |

Other tested failures include expired rolling/hard tokens, missing credentials,
invalid_grant with no repeat attempt, interrupted rotation, failed save before or
after remote rotation, shared-store serialization across two instances, API 401
refresh/retry, 403/404/429/500, malformed JSON/envelopes/rows, fetch/body timeouts,
invalid date/filter input, missing currency, duplicate or failed pagination,
missing links, mismatched amount/customer/currency, fee-net deposits and invalid
money precision. Every expired-auth read method is checked for `ok:false` with no
`data` property.

## Documentation verification and limits

The primary Intuit web pages rendered as shells to the web reader. Direct requests
to these public official static pages returned the actual documentation:

- [OAuth setup static HTML](https://static.developer.intuit.com/output_html/qbo/docs/develop/authentication-and-authorization/oauth-2.0.html)
- [OAuth FAQ static HTML](https://static.developer.intuit.com/output_html/qbo/docs/develop/authentication-and-authorization/faq.html)
- [Query guide static HTML](https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries.html)

They confirm the scope, token endpoint, one-hour access lifetime, rolling
100-day expiry, saving the latest pair, optional hard-expiry field, and query
paging/active-list syntax. Rotation need not change the token value on each
refresh; the FAQ describes approximately daily changes. Both unchanged and
changed refresh values are tested. No five-year lifetime is hard-coded.

The current Deposit API page did not yield usable content (main page shell;
static entity path unavailable). Official older SDK schemas establish line/link
fields, but **actual sandbox payloads and PayPal bank-feed linkage remain
unconfirmed**. Sources are linked in README. No third-party code was copied.

`npm ci` / `npm audit` reported **9 existing dependency advisories** (3 moderate,
4 high, 2 critical) in the Vitest/Vite development dependency tree. The original
lockfile is unchanged; dependency upgrades were not part of this adapter task.
This is a remaining dependency risk, not a clean security-audit claim.

## Deferred integration

The live sandbox smoke waits on operator card FPC-QBO-SETUP-OPERATOR-20261005.
Its local script syntax and pre-network gates were checked, but encrypted-file
round trips with real OAuth rotation have not been run. Production storage/lock
correctness, distributed fencing, OAuth callback/consent, reconnect UI, daily
scheduler, CDC/deleted-entity handling and real PayPal reconciliation require host
integration and runtime evidence. No tag/package release, review or merge occurs
in this task. Core-contracts coordination is needed before tagging the read API.
