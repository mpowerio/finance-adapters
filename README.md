# @mpowerio/finance-adapters

Factory Step 2 of the **mpowerio Vertical Factory** — a `FinanceAdapter` registry
plus a FreshBooks adapter, harvested from the MOC fintech integration layer
(`mpower-crm/src/lib/integrations/`).

Its second job is to be the **first cross-repo consumer of
[`@mpowerio/core-contracts`](https://github.com/mpowerio/core-contracts)**:
`createInvoice` maps each provider result into an `ArtifactRecord<'invoice'>`
**imported from the published package** — proving the contract resolves and
type-checks from a separate repo.

## Install

```jsonc
// package.json
"dependencies": {
  "@mpowerio/finance-adapters": "github:mpowerio/finance-adapters#v0.1.0"
}
```

It pulls `@mpowerio/core-contracts#v0.1.0` transitively.

## Shape

```ts
import {
  FreshBooksAdapter,
  registerAdapter,
  getAdapter,
  type FinanceAdapter,
  type InvoiceArtifact, // = ArtifactRecord<'invoice'> from core-contracts
} from '@mpowerio/finance-adapters';

registerAdapter(new FreshBooksAdapter());
const fb = getAdapter('freshbooks');

const res = await fb!.createInvoice({
  clientName: 'Acme',
  clientEmail: 'a@b.com',
  lineItems: [{ description: 'Roof repair', quantity: 1, unitPrice: 500 }],
  dueDate: '2026-07-15',
  sourceResourceType: 'estimate', // → ArtifactRecord.sourceResourceType
  sourceResourceId: 'est_123',
});
// res: { ok: true,  gated: false, data: ArtifactRecord<'invoice'> }
//    | { ok: false, gated: true,  error }   ← credentials absent
//    | { ok: false, gated: false, error }   ← live API error
```

## The credential gate

OAuth secrets do not exist in the packaging environment, so **every method is
gated**. If any of `FRESHBOOKS_CLIENT_ID`, `FRESHBOOKS_CLIENT_SECRET`,
`FRESHBOOKS_ACCESS_TOKEN`, `FRESHBOOKS_ACCOUNT_ID` is absent, the method returns
`{ ok: false, gated: true, error }` and makes **no live HTTP call** — `fetch` is
resolved only *after* the gate passes. The live REST path is fully structured
but un-exercised here; downstream tenant adoption (e.g. JBET OAuth + UI) is a
separate task.

The HTTP impl is injectable (`new FreshBooksAdapter({ fetchImpl })`) so the live
mapping is unit-tested against a mocked boundary with zero live calls.

## Develop

```bash
npm install      # also runs prepare → build
npm test         # vitest: FreshBooks, contracts/registry, QuickBooks
npm run build    # tsc → dist/ (committed)
npm run typecheck
```

Pure TypeScript, strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`,
zero runtime deps beyond `@mpowerio/core-contracts`.

## QuickBooks Online: read-first books adapter

`QuickBooksAdapter` implements the existing `FinanceAdapter` and the opt-in
`FinanceReadAdapter`. FreshBooks does not need new methods. This repository is
the canonical connector source; the QuickBooks implementation is original code
based on public Intuit documentation, with no third-party code copied.

Request only `QUICKBOOKS_SCOPE` (`com.intuit.quickbooks.accounting`) in the host's
OAuth flow. No Payments or Payroll scope. Accounting consent is write-capable;
this adapter enforces read-only behavior in code. `createInvoice` always returns
`writes_disabled`, without HTTP. PayPal remains the invoice rail. No sales-tax
calculation or customer-facing tax lines are added. `getBalance` returns
`unsupported_operation`: a company ledger is not a wallet. Use per-account
balances from `listAccounts` instead.

```ts
import { QuickBooksAdapter, type QuickBooksTokenStore } from '@mpowerio/finance-adapters';

// Implement using your encrypted connection store and a distributed lock.
// See the persistence contract below; never use an in-memory store in production.
declare const tokenStore: QuickBooksTokenStore;
const qbo = new QuickBooksAdapter({
  connection: { tenantId: 'tenant-key', realmId: '123456789', environment: 'sandbox' },
  tokenStore,
  homeCurrency: 'USD', // verify this company's currency; no implicit USD fallback
});
const result = await qbo.listDeposits({ updatedSince: '2026-01-01T00:00:00Z' });
if (!result.ok) {
  // gated = configuration missing; failure.code identifies the action required.
  // reconnect_needed => stop sync + show a persistent Reconnect QuickBooks banner.
  // rate_limited => schedule retry, respecting retryAfterSeconds when supplied.
  throw new Error(result.error); // host handles this visibly; never substitute []
}
// Only here does [] mean a successful examination with no records.
```

App configuration comes from `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`,
and `QUICKBOOKS_REDIRECT_URI`, or `readCredentials`. Connection identity and token
storage are explicit; a missing item gates before HTTP. The host owns the OAuth
redirect/state validation, code exchange, encrypted secret storage, banner and
reconnect flow. Do not register per-tenant instances in the package's global
name-only registry: it holds one instance per provider, not tenant isolation.
Keep instances in the host's tenant-scoped connection container.

Reads: `listAccounts`, `listCustomers`, `listVendors`, `listPurchases`, `listBills`,
`listDeposits`, `listPayments`, `listInvoices`; `syncCustomers` aliases the customer
read. All support `updatedSince`, including invoices. Invoice filters also accept
QBO numeric `clientId`, transaction `from`/`to` dates, and `paid`/`unpaid` (`unpaid`
includes partial balances). Provider invoice numbers and customer IDs are retained.
`Vendor1099` is a signal only; classification needs operator confirmation.
Purchases are posted accounting records, **not unreviewed bank-feed downloads**.

`listPurchases` returns `PurchaseResult`: `paymentType` is `Cash`, `Check`, or
`CreditCard`; `credit: true` identifies a credit-card refund. Totals and line
amounts retain provider values, without sign conversion. Consumers must use
`credit` when interpreting spending. Intuit defines missing/null `Credit` as a
charge (`credit: false`); malformed flags, unknown payment types, and credits on
non-card purchases fail with `invalid_response`.
Purchase payees retain `EntityRef` as `entityRef: { value, type, name? }`, where
`type` is `Vendor`, `Customer`, or `Employee`. Only Vendor sets `vendorId`; other
payees are never relabeled as vendors. An absent payee remains absent; a present
but malformed or unsupported reference fails the entire read. Bills continue to
use `VendorRef`. No tax is computed or added by these mappings.

Queries include inactive Accounts/Customers/Vendors, fetch every page, and fail
without returning partial results when a page is corrupt, repeats IDs, exceeds the
configured cap, or cannot be fetched. Defaults: 1,000 rows/page, 1,000 pages/read,
30-second request deadline (including body). Requests do not follow redirects.
Failures are redacted typed results, including `reconnect_needed`, `rate_limited`,
`not_found`, `forbidden`, `api_error`, `invalid_response`, `timeout`, and
`storage_error`. An explicit `QueryResponse: {}` is Intuit's successful-empty
shape; absent/wrong entity envelopes and Faults are failures.
The adapter omits `minorversion`; the official minor-version guide reviewed on
2026-10-23 says omitted values receive version 75. This is a provider default,
not a pinned version or a claim about future behavior.

### Token persistence and scheduled refresh

Implement `QuickBooksTokenStore.withLock(key, work)` with exclusion across **all
workers and OAuth callbacks** for that connection. Use `quickBooksConnectionKey`
(app/client ID, environment, tenant, realm) for both callbacks and reads. Under the
lock, load the latest record; never cache an earlier token pair. `save` must commit
one complete encrypted record durably **before resolving**, and its commits must
survive later callback failures. Do not wrap the whole callback in a transaction
that rolls back saves if HTTP fails. A session-level advisory lock plus separate
committed saves, or a durable external mutex, can meet this contract; a leased
lock requires fencing and safe renewal for the entire callback.

State contains `status`, `accessToken`, `refreshToken`, `accessTokenExpiresAt`,
`refreshTokenExpiresAt` and optional `refreshTokenHardExpiresAt`; all times are
absolute epoch milliseconds. Initialize expiries from the OAuth response's receipt
time plus its lifetime fields. Keep the shorter of the reported rolling lifetime
and 100 days. Preserve the optional hard expiry across refreshes that omit it.

The adapter refreshes at five minutes remaining or after one API 401, saves every
returned token pair (including an unchanged refresh-token value), and retries a
401 read once. It saves `refreshing` **before** asking Intuit to rotate. A crash,
uncertain refresh response or failed persistence cannot silently reuse old tokens:
the next run requires reconnect. An expired rolling/hard lifetime or `invalid_grant`
persists `needs_reauth`, stops the sync and returns `connectionStatus: needs_reauth`.
A failed store save returns `storage_error`, also requiring a visible stop.

Run `refreshConnection()` daily per active connection in the host scheduler, even
when no books reads are needed. That method refreshes and persists without reading
entities. No scheduler is installed by this package. Schedule bounded retries for
rate limits (Intuit recommends waiting 60 seconds), but never loop on
`reconnect_needed`. Only a successful host reauthorization should replace that state.

For initial pulls use the runbook's 2026-01-01 backfill, then inclusive
`MetaData.LastUpdatedTime` cursors with overlap and upsert by provider ID. Advance
cursors only after all reads and host persistence succeed. Query pagination is not
a point-in-time snapshot; concurrent edits can move rows. Deleted-entity tracking,
CDC catch-up, webhooks, host scheduler/UI and durable production storage integration
are separate host work; this package does not claim a complete sync engine.

### Conservative PayPal matching

`matchPayPalDeposit(paypalEvidence, { invoices, payments, deposits })` requires
successful complete reads from **one tenant/realm** and a host-verified QBO customer
mapping. It follows Deposit line → Payment line → Invoice and requires an exact
invoice number, PayPal payment reference, customer, currency and two-decimal amount.
It returns `matched`, `unmatched`, or `ambiguous`; malformed input is a typed failure.
It never matches on customer name or amount alone, chooses a duplicate, writes the
books, or marks an invoice paid. Missing references, fee-net deposits, batches and
partial allocations stay unmatched for manual reconciliation.

Synthetic known answer declared before execution: `PP-001`, invoice `FPC-1001`,
USD 125.00 → `D-1` / `P-1` / `I-1` only. The test exercises actual adapter mapping
with mocked HTTP, as well as duplicate and amount/currency/customer negatives.

### Operator sandbox smoke (not yet run live)

Blocked on operator card `FPC-QBO-SETUP-OPERATOR-20261005`: create the Intuit developer
app/sandbox and authorize **sandbox credentials only**, requesting the accounting
scope only. No account creation is automated here. Use Node 20+.

1. In the Intuit sandbox OAuth flow/playground, obtain an initial token pair and
   its lifetime fields. Store secrets through your approved local secret manager;
   never paste token values into shell history, chat, a PR or repository files.
2. Inject the three app variables above plus `QUICKBOOKS_SANDBOX_REALM_ID`,
   `QUICKBOOKS_SMOKE_TENANT_ID`, and verified `QUICKBOOKS_HOME_CURRENCY`.
3. Create a private directory outside this repo for `QUICKBOOKS_TOKEN_FILE` (an
   absolute filename). Inject `QUICKBOOKS_TOKEN_KEY_BASE64`, a secret random 32-byte
   AES key encoded as base64, from the same approved store. Do not lose the key.
4. For the first run only, inject `QUICKBOOKS_ACCESS_TOKEN`,
   `QUICKBOOKS_REFRESH_TOKEN`, `QUICKBOOKS_ACCESS_EXPIRES_AT_MS`,
   `QUICKBOOKS_REFRESH_EXPIRES_AT_MS`, and, when supplied,
   `QUICKBOOKS_REFRESH_HARD_EXPIRES_AT_MS`. These are absolute expiry times, not
   seconds-to-expiry. Later runs use the encrypted file, not the bootstrap pair.
5. Run `npm run smoke:quickbooks -- --sandbox`. It forces one token refresh,
   atomically saves the pair in an AES-GCM encrypted mode-0600 file, then reads all
   eight entities. It emits counts/status only. Empty lists are valid examinations;
   any gate/failure exits nonzero. It allows only sandbox GETs and the shared Intuit
   token endpoint POST; production API traffic is refused.
6. Run again to prove stored rotation is usable. If interrupted, inspect the
   private `.lock` directory and verify no smoke process is alive before removing
   that stale lock. `refreshing`/`needs_reauth` requires fresh authorization; do not
   reset state by hand. An existing file for another connection is refused.

The script is a single-connection smoke helper, not the host production store. Its
file/lock setup assumes a trusted local private directory. Sandbox success does
not prove real PayPal bank-feed reconciliation; verify a real linked example with
the operator separately, without exposing private rows in receipts.

### Verification and current documentation

```bash
npm ci
npm test
npm run typecheck
npm run lint                      # strict compiler lint, no ESLint configured
npm run build                     # committed dist/ consumed by package users
npm run test:quickbooks:negative   # three deliberate defects must be caught
```

See [verification evidence](docs/quickbooks-verification.md) and
[implementation plan](docs/quickbooks-plan.md). Source facts checked 2026-10-23:

- [Intuit OAuth setup](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
  and [authorization FAQ](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq):
  accounting scope, bearer-token endpoint, one-hour access lifetime, rolling
  100-day refresh lifetime, latest-pair persistence, optional hard expiry. Retrieved
  public static HTML after the main pages rendered as shells; hard-expiry request
  uses the documented `x-include-refresh-token-hard-expires-in: true` header.
- [Intuit query guide](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries)
  and [limits](https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html):
  query paging, inactive-name-list inclusion and the 1,000-row maximum.
- [Payment reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment):
  line links identify invoices; the accounting Payment entity is distinct from the
  separate Intuit Payments API.
- [Official Vendor schema](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippphpdevkitv3/entities/files/IPPVendor.html),
  [Deposit schema](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippphpdevkitv3/entities/files/IPPDeposit.html),
  and [Line schema](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/33084f47-b42b-db2f-0abd-2c22f2c02cb2.htm):
  Vendor1099 and linked transaction fields. These SDK schema pages are older;
  the current Deposit API page did not yield usable content. Actual sandbox
  Deposit shapes and linked-bank-feed behavior remain unconfirmed.
- [Official Purchase schema](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippphpdevkitv3/entities/files/IPPPurchase.html)
  and [official PHP SDK definition](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPPurchase.php):
  credit-card refund direction, null/false charge default, required PaymentType,
  and typed EntityRef payees. Repair r1 consulted the review's saved 2026-10-23
  copies; it made no Intuit network requests and copied no SDK implementation.
- [Minor-version guide](https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions.html):
  omitted/retired minor versions default to 75, per the saved review evidence.
