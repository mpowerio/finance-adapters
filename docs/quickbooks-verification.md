# QuickBooks adapter verification — 2026-10-23

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
