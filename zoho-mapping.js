// Maps Zoho Books API responses into import.js's ledger shape
// ({ entities: [{id,label}], obligations: [{id,from,to,amount,currency}] }) so a pulled
// vendor ledger goes through the exact same validateLedger() -> apply/reset path as a
// CSV/JSON upload. Pure and dependency-free, unit-tested without a network call — the
// same pure/impure split as voice-grammar.js/voice.js and fx.js's invertRates().
//
// Scope (spec §10/§19): vendors + unpaid bills only. Zoho Books also has
// Invoices/Customers (money owed *to* the org) — same pattern, not built here; the
// roadmap item this closes was "vendor-master."

export function mapZohoToLedger({ organizationId, organizationName, vendors, bills }) {
  const orgId = `zoho:org:${organizationId}`;
  const entities = [
    { id: orgId, label: organizationName || "Your organization" },
    ...vendors.map((v) => ({ id: `zoho:vendor:${v.contact_id}`, label: v.contact_name })),
  ];

  // Only unpaid balance becomes an obligation — a fully paid bill isn't a live obligation
  // to net, and using `balance` (not `total`) means a partial payment is reflected too.
  const obligations = bills
    .filter((b) => Number(b.balance) > 0)
    .map((b) => ({
      id: `zoho:bill:${b.bill_id}`,
      from: orgId,
      to: `zoho:vendor:${b.vendor_id}`,
      amount: Number(b.balance),
      currency: b.currency_code || "INR",
    }));

  return { entities, obligations };
}
