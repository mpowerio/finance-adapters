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
npm test         # vitest, 16 tests
npm run build    # tsc → dist/ (committed)
npm run typecheck
```

Pure TypeScript, strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`,
zero runtime deps beyond `@mpowerio/core-contracts`.
