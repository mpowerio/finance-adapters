import { expect, it, vi } from "vitest";
import { PayPalAdapter, transaction } from "./paypal.js";
const approval = {
  approvedBy: "operator",
  get approvedAt() {
    return new Date().toISOString();
  },
  nonce: "happy",
  expectedInvoiceId: "I-1",
  expectedRecipientEmail: "buyer@example.invalid",
  expectedInvoiceNumber: "INV-1",
};
const invoice = {
  id: "I-1",
  detail: { invoice_number: "INV-1" },
  amount: { value: "1.00", currency_code: "USD" },
  status: "SENT",
  primary_recipients: [
    { billing_info: { email_address: approval.expectedRecipientEmail } },
  ],
};
function fixture() {
  vi.stubEnv("PAYPAL_CLIENT_ID", "fixture");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "fixture");
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        url.endsWith("/token")
          ? '{"access_token":"fixture"}'
          : url.endsWith("/cancel")
            ? null
            : JSON.stringify(invoice),
      ),
  );
  return { adapter: new PayPalAdapter(fetcher), fetcher };
}
it.each([
  ["approvedBy", " "],
  ["approvedAt", "invalid"],
  ["approvedAt", "1"],
  ["approvedAt", "1970-01-01T00:00:00Z"],
  ["approvedAt", "2099-01-01T00:00:00Z"],
  ["nonce", " "],
  ["expectedInvoiceId", "I-2"],
  ["expectedRecipientEmail", "BUYER@example.invalid"],
  ["expectedRecipientEmail", " buyer@example.invalid"],
  ["expectedRecipientEmail", "other@example.invalid"],
  ["expectedInvoiceNumber", "INV-2"],
])("refuses invalid %s", async (key, value) => {
  const { adapter, fetcher } = fixture();
  expect(
    (
      await adapter.cancelInvoice(invoice.id, {
        ...approval,
        nonce: "invalid-" + value,
        [key!]: value,
      })
    ).ok,
  ).toBe(false);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(
    false,
  );
});
it("cancels after reading identity and suppresses recipient notification", async () => {
  const { adapter, fetcher } = fixture();
  expect((await adapter.cancelInvoice(invoice.id, approval)).ok).toBe(true);
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining("/I-1/cancel"),
    expect.objectContaining({
      body: JSON.stringify({ send_to_recipient: false }),
    }),
  );
});
it("counts Amex fee as merchant expense", () => {
  expect(
    transaction({
      transaction_id: "test",
      transaction_event_code: "T0006",
      invoice_id: "FPC-2026-17-OS",
      transaction_amount: { value: "750.00", currency_code: "USD" },
      fee_amount: { value: "-22.92", currency_code: "USD" },
    }),
  ).toMatchObject({ gross: 75000, fee: 2292, net: 72708 });
});
function scripted(responses: Response[]) {
  fixture();
  return new PayPalAdapter(async (url) =>
    url.endsWith("/token")
      ? Response.json({ access_token: "fixture" })
      : responses.shift()!,
  );
}
it.each([
  [
    "ambiguous",
    {
      ...invoice,
      primary_recipients: [
        ...invoice.primary_recipients,
        ...invoice.primary_recipients,
      ],
    },
  ],
  [
    "ambiguous",
    {
      ...invoice,
      primary_recipients: [
        ...invoice.primary_recipients,
        { billing_info: { email_address: "other@example.invalid" } },
      ],
    },
  ],
  ["status cannot", { ...invoice, status: "PAID" }],
  ["ID mismatch", { ...invoice, id: "different" }],
  ["recipient missing", { ...invoice, primary_recipients: [] }],
  [
    "recipient email",
    { ...invoice, primary_recipients: [{ billing_info: {} }] },
  ],
])("blocks cancellation on %s", async (message, row) => {
  const result = await scripted([
    Response.json(row),
    new Response(null),
  ]).cancelInvoice(invoice.id, approval);
  expect(result).toMatchObject({
    ok: false,
    error: expect.stringContaining(String(message)),
  });
});
it("hydrates list recipient and recurring series from detail", async () => {
  const result = await scripted([
    Response.json({ items: [{ id: invoice.id }], total_pages: 1 }),
    Response.json({ ...invoice, recurring_Id: "SERIES" }),
  ]).listInvoices({ status: "SENT" });
  expect(result).toMatchObject({
    ok: true,
    data: [
      {
        seriesId: "SERIES",
        recipient: { email: approval.expectedRecipientEmail },
      },
    ],
  });
});
it("surfaces reporting permissions", async () => {
  expect(
    await scripted([
      Response.json({ name: "NOT_AUTHORIZED" }, { status: 403 }),
    ]).searchTransactions("2026-01-01", "2026-01-31"),
  ).toMatchObject({
    ok: false,
    error: expect.stringContaining("permission missing"),
  });
});
it("refuses overlong reporting periods", async () => {
  expect(
    await scripted([]).searchTransactions("2026-01-01", "2026-02-02"),
  ).toMatchObject({ ok: false, error: expect.stringContaining("31 days") });
});
it.each(["SUCCESS", "FAILURE"])(
  "verifies webhook signature %s",
  async (status) => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "fixture");
    const headers = new Headers();
    for (const field of [
      "auth-algo",
      "cert-url",
      "transmission-id",
      "transmission-sig",
      "transmission-time",
    ])
      headers.set(
        "paypal-" + field,
        field === "transmission-time" ? new Date().toISOString() : "fixture",
      );
    const event = {
      id: "EV-1",
      event_type: "INVOICING.INVOICE.PAID",
      resource: { invoice: { id: "I-1" } },
    };
    const result = await scripted([
      Response.json({ verification_status: status }),
    ]).verifyWebhook(headers, event);
    expect(result).toMatchObject(
      status === "SUCCESS"
        ? { ok: true, data: { idempotencyKey: "EV-1", resourceId: "I-1" } }
        : { ok: false, error: "Invalid PayPal webhook signature" },
    );
  },
);
it("consumes a nonce across concurrent adapter instances", async () => {
  const a = fixture(),
    b = fixture(),
    shared = { ...approval, nonce: "replay" };
  const results = await Promise.all([
    a.adapter.cancelInvoice(invoice.id, shared),
    b.adapter.cancelInvoice(invoice.id, shared),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results).toContainEqual(
    expect.objectContaining({ error: "Approval nonce already used" }),
  );
});
it.each([
  { page: 2, total_pages: 1 },
  { page: 1, total_pages: "1" },
  { page: 1 },
  { page: 1, total_pages: -1 },
])("rejects malformed reporting metadata %o", async (meta) => {
  expect(
    await scripted([
      Response.json({ ...meta, transaction_details: [] }),
    ]).searchTransactions("2026-01-01", "2026-01-02"),
  ).toMatchObject({ error: "Incomplete transaction page" });
});
it("reads three invoice pages including a recipient-less draft", async () => {
  const ids = ["I-a", "I-b", "I-c"];
  const result = await scripted(
    ids.flatMap((id, i) => [
      Response.json({ total_pages: 3, items: [{ id }] }),
      Response.json({
        ...invoice,
        id,
        primary_recipients: i === 1 ? [] : invoice.primary_recipients,
      }),
    ]),
  ).listInvoices();
  expect(result).toMatchObject({
    ok: true,
    data: ids.map((id, i) => ({
      id,
      recipient: { email: i === 1 ? null : approval.expectedRecipientEmail },
    })),
  });
});
const info = {
  transaction_id: "T1",
  transaction_event_code: "T0006",
  transaction_amount: { value: "1.00", currency_code: "USD" },
};
it("reads every reporting page", async () => {
  const result = await scripted(
    [1, 2, 3].map((page) =>
      Response.json({
        page,
        total_pages: 3,
        transaction_details: [
          { transaction_info: { ...info, transaction_id: String(page) } },
        ],
      }),
    ),
  ).searchTransactions("2026-01-01", "2026-01-02");
  expect(result).toMatchObject({
    ok: true,
    data: [{ id: "1" }, { id: "2" }, { id: "3" }],
  });
});
it("refuses fees in a different currency", () => {
  expect(() =>
    transaction({
      ...info,
      fee_amount: { value: "-0.01", currency_code: "CAD" },
    }),
  ).toThrow("Fee currency mismatch");
});
it.each([
  ["OTHER", 0, "Unsupported PayPal webhook event"],
  ["PAYMENT.CAPTURE.COMPLETED", 600001, "Stale webhook transmission"],
] as const)("rejects webhook %s at age %d", async (type, age, error) => {
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "fixture");
  const headers = new Headers();
  for (const field of [
    "auth-algo",
    "cert-url",
    "transmission-id",
    "transmission-sig",
  ])
    headers.set("paypal-" + field, "fixture");
  headers.set(
    "paypal-transmission-time",
    new Date(Date.now() - age).toISOString(),
  );
  expect(
    await scripted([
      Response.json({ verification_status: "SUCCESS" }),
    ]).verifyWebhook(headers, {
      id: "EV",
      event_type: type,
      resource: { id: "R" },
    }),
  ).toMatchObject({ error });
});
it.each([
  [-60001, false],
  [-60000, true],
  [900000, true],
  [900001, false],
] as const)("enforces approval age %d", async (age, allowed) => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    const result = await fixture().adapter.cancelInvoice(invoice.id, {
      ...approval,
      nonce: "boundary" + age,
      approvedAt: new Date(Date.now() - age).toISOString(),
    });
    expect(result.ok).toBe(allowed);
  } finally {
    vi.useRealTimers();
  }
});
it("rejects a fresh timestamp with non-ISO separators", async () => {
  const result = await fixture().adapter.cancelInvoice(invoice.id, {
    ...approval,
    nonce: "format",
    approvedAt: new Date().toISOString().replace("T", " "),
  });
  expect(result).toMatchObject({ error: "Invalid approvedAt" });
});
