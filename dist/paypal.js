/// <reference lib="dom" />
import { failure, ok, } from "./types.js";
function required(value, field) {
    if (typeof value !== "string" || !value.trim())
        throw Error("Missing " + field);
    return value;
}
function cents(value) {
    if (typeof value !== "string" || !/^-?\d+(\.\d{1,2})?$/.test(value))
        throw Error("Invalid decimal amount");
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    const result = Number(BigInt(whole + fraction.padEnd(2, "0"))) *
        (value.startsWith("-") ? -1 : 1);
    if (!Number.isSafeInteger(result))
        throw Error("Amount exceeds safe integer range");
    return result;
}
export function transaction(info) {
    const currency = required(info.transaction_amount.currency_code, "transaction currency");
    if (info.fee_amount && info.fee_amount.currency_code !== currency)
        throw Error("Fee currency mismatch");
    const gross = cents(info.transaction_amount.value), fee = info.fee_amount ? -cents(info.fee_amount.value) : 0;
    const net = gross - fee;
    if (!Number.isSafeInteger(net))
        throw Error("Net exceeds safe integer range");
    return {
        id: required(info.transaction_id, "transaction id"),
        invoiceNumber: info.invoice_id,
        code: info.transaction_event_code,
        currency,
        gross,
        fee,
        net,
    };
}
async function result(operation) {
    try {
        return ok(await operation());
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : "PayPal request failed");
    }
}
const events = new Set([
    "INVOICING.INVOICE.PAID",
    "INVOICING.INVOICE.CANCELLED",
    "INVOICING.INVOICE.REFUNDED",
    "PAYMENT.CAPTURE.COMPLETED",
    "PAYMENT.CAPTURE.REFUNDED",
]);
export class PayPalAdapter {
    transport;
    name = "paypal";
    constructor(transport = fetch) {
        this.transport = transport;
    }
    async createInvoice() {
        return failure("PayPal invoice creation is unsupported");
    }
    async getBalance() {
        return failure("PayPal balance is unexamined");
    }
    async syncCustomers() {
        return failure("PayPal customer sync is unsupported");
    }
    async request(path, body) {
        const mode = process.env.PAYPAL_ENV ?? "sandbox";
        if (!["sandbox", "live"].includes(mode))
            throw Error("Invalid PAYPAL_ENV");
        const base = mode === "live"
            ? "https://api-m.paypal.com"
            : "https://api-m.sandbox.paypal.com";
        const credentials = required(process.env.PAYPAL_CLIENT_ID, "PAYPAL_CLIENT_ID") +
            ":" +
            required(process.env.PAYPAL_CLIENT_SECRET, "PAYPAL_CLIENT_SECRET");
        const token = await this.transport(base + "/v1/oauth2/token", {
            method: "POST",
            redirect: "error",
            headers: {
                Authorization: "Basic " + btoa(credentials),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
        });
        if (!token.ok)
            throw Error("PayPal OAuth HTTP " + token.status);
        const access = required((await token.json()).access_token, "access token");
        const response = await this.transport(base + path, {
            redirect: "error",
            headers: {
                Authorization: "Bearer " + access,
                "Content-Type": "application/json",
            },
            ...(body === undefined
                ? {}
                : { method: "POST", body: JSON.stringify(body) }),
        });
        if (!response.ok)
            throw Error(response.status === 403
                ? "PayPal permission missing (HTTP 403)"
                : "PayPal HTTP " + response.status);
        const raw = await response.text();
        return raw ? JSON.parse(raw) : null;
    }
    async invoice(id) {
        if (!/^[a-zA-Z0-9_-]+$/.test(required(id, "invoice id")))
            throw Error("Invalid invoice id");
        const row = await this.request("/v2/invoicing/invoices/" + id);
        if (row.id !== id)
            throw Error("Invoice ID mismatch");
        if (row.primary_recipients?.length !== 1)
            throw Error("Invoice recipient missing or ambiguous");
        const billing = row.primary_recipients[0].billing_info;
        return {
            id,
            externalId: id,
            number: required(row.detail.invoice_number, "invoice number"),
            recipient: {
                name: billing.name?.full_name ||
                    [billing.name?.given_name, billing.name?.surname]
                        .filter(Boolean)
                        .join(" ") ||
                    null,
                business: billing.business_name ?? null,
                email: required(billing.email_address, "recipient email"),
            },
            status: required(row.status, "status"),
            amount: cents(row.amount.value),
            currency: required(row.amount.currency_code, "currency"),
            invoiceDate: row.detail.invoice_date ?? null,
            dueDate: row.detail.payment_term?.due_date ?? "",
            seriesId: row.recurring_Id ??
                row.detail.recurring_id ??
                row.recurring_series_id ??
                null,
        };
    }
    getInvoice(id) {
        return result(() => this.invoice(id));
    }
    listInvoices(filters = {}) {
        return result(async () => {
            if (Object.keys(filters).some((k) => k !== "status"))
                throw Error("Unsupported PayPal invoice filter");
            const invoices = [], seen = new Set();
            for (let page = 1;; page++) {
                const rows = await this.request("/v2/invoicing/invoices?page_size=100&total_required=true&page=" +
                    page);
                if (!Array.isArray(rows.items) ||
                    !Number.isInteger(rows.total_pages) ||
                    rows.total_pages < 0)
                    throw Error("Incomplete invoice page");
                for (const item of rows.items) {
                    if (seen.has(item.id))
                        throw Error("Repeated invoice in pagination");
                    seen.add(item.id);
                    const invoice = await this.invoice(item.id);
                    if (!filters.status || invoice.status === filters.status)
                        invoices.push(invoice);
                }
                if (page >= rows.total_pages)
                    return invoices;
            }
        });
    }
    cancelInvoice(id, approval) {
        return result(async () => {
            const approvedBy = required(approval?.approvedBy, "approvedBy");
            const approvedAt = approval.approvedAt;
            if (!Number.isFinite(Date.parse(approvedAt)))
                throw Error("Invalid approvedAt");
            const email = approval.expectedRecipientEmail, number = approval.expectedInvoiceNumber;
            const invoice = await this.invoice(id);
            if (email !== invoice.recipient.email)
                throw Error("Recipient email mismatch");
            if (number !== invoice.number)
                throw Error("Invoice number mismatch");
            await this.request("/v2/invoicing/invoices/" + id + "/cancel", {
                send_to_recipient: false,
            });
            return {
                id,
                approvedBy,
                approvedAt,
                recipientEmail: email,
                invoiceNumber: number,
                acceptedAt: new Date().toISOString(),
                customerNotification: false,
            };
        });
    }
    searchTransactions(start, end) {
        return result(async () => {
            const duration = Date.parse(end) - Date.parse(start);
            if (!Number.isFinite(duration) ||
                duration <= 0 ||
                duration > 31 * 86400000)
                throw Error("Reporting interval must be positive and at most 31 days");
            const transactions = [];
            for (let page = 1;; page++) {
                const query = new URLSearchParams({
                    start_date: start,
                    end_date: end,
                    fields: "transaction_info",
                    page: String(page),
                    page_size: "500",
                });
                const rows = await this.request("/v1/reporting/transactions?" + query);
                if (!Array.isArray(rows.transaction_details) ||
                    rows.page !== page ||
                    !Number.isInteger(rows.total_pages) ||
                    rows.total_pages < 0)
                    throw Error("Incomplete transaction page");
                for (const row of rows.transaction_details)
                    transactions.push(transaction(row.transaction_info));
                if (page >= rows.total_pages)
                    return transactions;
            }
        });
    }
    verifyWebhook(headers, event) {
        return result(async () => {
            const body = {
                webhook_event: event,
                webhook_id: required(process.env.PAYPAL_WEBHOOK_ID, "PAYPAL_WEBHOOK_ID"),
            };
            for (const field of [
                "auth_algo",
                "cert_url",
                "transmission_id",
                "transmission_sig",
                "transmission_time",
            ]) {
                body[field] = required(headers.get("paypal-" + field.replaceAll("_", "-")), field);
            }
            const check = await this.request("/v1/notifications/verify-webhook-signature", body);
            if (check?.verification_status !== "SUCCESS")
                throw Error("Invalid PayPal webhook signature");
            if (!events.has(event.event_type))
                throw Error("Unsupported PayPal webhook event");
            return {
                idempotencyKey: required(event.id, "event id"),
                type: event.event_type,
                resourceId: required(event.resource.invoice?.id ?? event.resource.id, "resource id"),
            };
        });
    }
}
//# sourceMappingURL=paypal.js.map