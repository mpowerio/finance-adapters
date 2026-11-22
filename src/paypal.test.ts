import { expect, it, vi } from "vitest";
import { PayPalAdapter, transaction } from "./paypal.js";
const approval = {
  approvedBy: "operator",
  approvedAt: "2026-11-22T12:00:00Z",
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
  ["expectedRecipientEmail", "other@example.invalid"],
  ["expectedInvoiceNumber", "INV-2"],
])("refuses invalid %s", async (key, value) => {
  const { adapter, fetcher } = fixture();
  expect(
    (await adapter.cancelInvoice(invoice.id, { ...approval, [key!]: value }))
      .ok,
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
      headers.set("paypal-" + field, "fixture");
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
