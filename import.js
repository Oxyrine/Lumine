// CSV / JSON ledger import — hand-rolled parsing, no dependency. This module
// only returns plain data; every value it produces is untrusted and must go
// through esc()/html`` at the render call site in app.js, same as any other
// dynamic value in this app.

function parseCSVLine(line) {
  // No quoted-field support: a deliberate, honest limit for a "very
  // rudimentary" import. A field containing a comma isn't representable.
  return line.split(",").map((s) => s.trim());
}

export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { entities: null, obligations: [] };
  const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name) => header.indexOf(name);
  const iId = col("id"), iFrom = col("from"), iTo = col("to"), iAmount = col("amount"), iCcy = col("currency");
  const obligations = lines.slice(1).map((line, i) => {
    const cells = parseCSVLine(line);
    return {
      row: i + 2, // header is row 1
      id: iId >= 0 ? cells[iId] : undefined,
      from: iFrom >= 0 ? cells[iFrom] : undefined,
      to: iTo >= 0 ? cells[iTo] : undefined,
      amount: iAmount >= 0 ? cells[iAmount] : undefined,
      currency: iCcy >= 0 ? cells[iCcy] : undefined,
    };
  });
  return { entities: null, obligations };
}

// Accepts either a bare obligations array or { entities?, obligations }.
// Throws on malformed JSON — the caller surfaces that as a single error.
export function parseJSON(text) {
  const data = JSON.parse(text);
  const obligations = Array.isArray(data) ? data : Array.isArray(data?.obligations) ? data.obligations : [];
  const entities = Array.isArray(data?.entities) ? data.entities : null;
  return { entities, obligations: obligations.map((o, i) => ({ row: i + 1, ...o })) };
}

// Every row is checked independently and a bad row is reported, never
// silently dropped from the error list (it IS dropped from the netting run —
// "dropped silently" here means without surfacing why).
export function validateLedger({ entities, obligations }) {
  const errors = [];
  const seenIds = new Set();
  const knownIds = entities ? new Set(entities.map((e) => String(e.id).trim())) : null;
  const clean = [];

  for (const o of obligations) {
    const row = o.row;
    const id = o.id == null ? "" : String(o.id).trim();
    const from = o.from == null ? "" : String(o.from).trim();
    const to = o.to == null ? "" : String(o.to).trim();
    const amount = typeof o.amount === "number" ? o.amount : parseFloat(o.amount);
    const currency = o.currency ? String(o.currency).trim().toUpperCase() : "INR";

    if (!id) { errors.push({ row, message: "missing id" }); continue; }
    if (!from) { errors.push({ row, message: `${id}: missing "from"` }); continue; }
    if (!to) { errors.push({ row, message: `${id}: missing "to"` }); continue; }
    if (from === to) { errors.push({ row, message: `${id}: "from" and "to" are the same entity (${from})` }); continue; }
    if (!Number.isFinite(amount) || amount <= 0) { errors.push({ row, message: `${id}: amount "${o.amount}" is not a positive number` }); continue; }
    if (seenIds.has(id)) { errors.push({ row, message: `${id}: duplicate obligation id` }); continue; }
    if (knownIds && (!knownIds.has(from) || !knownIds.has(to))) {
      const unknown = [!knownIds.has(from) ? from : null, !knownIds.has(to) ? to : null].filter(Boolean).join(", ");
      errors.push({ row, message: `${id}: unknown entity id(s): ${unknown}` });
      continue;
    }
    seenIds.add(id);
    clean.push({ id, from, to, amount, currency });
  }

  const derivedEntities = entities
    ? entities.map((e) => ({ id: String(e.id).trim(), label: e.label ? String(e.label).trim() : String(e.id).trim() }))
    : [...new Set(clean.flatMap((o) => [o.from, o.to]))].sort().map((id) => ({ id, label: id }));

  return { obligations: clean, entities: derivedEntities, errors };
}

export const SAMPLE_CSV =
  `id,from,to,amount,currency
imp1,riverside,haldane,220000,INR
imp2,haldane,solace,95000,INR
imp3,solace,riverside,60000,INR
imp3,riverside,solace,15000,INR
imp4,quill,quill,5000,INR
imp5,haldane,vasant,42000,USD
`;
