#!/usr/bin/env node
import { PayPalAdapter } from "../dist/index.js";
const [provider, command, ...args] = process.argv.slice(2);
if (
  provider !== "paypal" ||
  command !== "invoices" ||
  !(
    args.length === 0 ||
    (args.length === 2 && args[0] === "--status" && args[1])
  )
) {
  console.error("Usage: finance-adapters paypal invoices [--status SENT]");
  process.exitCode = 2;
} else {
  const result = await new PayPalAdapter().listInvoices(
    args.length ? { status: args[1] } : {},
  );
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
  } else if (!result.data.length) console.log("No matching invoices.");
  else
    console.table(
      result.data.map(({ number, status, recipient, amount, currency }) => ({
        number,
        status,
        recipient: [recipient.name, recipient.business, recipient.email]
          .filter(Boolean)
          .join(" | "),
        amountCents: amount,
        currency,
      })),
    );
}
