const test = require('node:test');
const assert = require('node:assert/strict');

const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');
const reports = require('../lib/reports');

function order(overrides = {}) {
  return {
    id: 41,
    date: '2026-11-21',
    customer: 'Test Customer',
    paymentMode: 'cash',
    status: 'completed',
    items: [
      { id: 7, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 100, qty: 2 }
    ],
    coupon: '',
    subtotal: 200,
    discount: 0,
    tax: 10,
    total: 210,
    ...overrides
  };
}

test('pricing uses the HSN slab and returns the billed GST split', () => {
  const totals = pricing.computeTotals(order().items, '');

  assert.deepEqual(totals, {
    subtotal: 200,
    discount: 0,
    taxable: 200,
    tax: 10,
    cgst: 5,
    sgst: 5,
    total: 210,
    lines: [{
      id: 7,
      name: 'Rice',
      hsn: '1006',
      gstPercent: 5,
      gross: 200,
      discount: 0,
      taxable: 200,
      tax: 10,
      net: 210
    }]
  });
});

test('invoice uses the HSN slab and matches the ledger tax and total', () => {
  const figures = invoice.computeInvoiceFigures(order());

  assert.deepEqual(figures, {
    subtotal: 200,
    discount: 0,
    tax: 10,
    cgst: 5,
    sgst: 5,
    total: 210,
    rows: [{
      name: 'Rice',
      sku: 'RICE-1',
      hsn: '1006',
      qty: 2,
      price: 100,
      gstPercent: 5,
      line: 200,
      lineTax: 10
    }]
  });
});

test('rendered invoice shows the stored billed total without a reconciliation warning', () => {
  const html = invoice.render(order());

  assert.match(html, /Invoice Total<\/td><td class="r">₹210\.00/);
  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">₹10\.00/);
  assert.doesNotMatch(html, /differs from Order Ledger recorded total/);
});

test('invoice applies flat coupon discounts before calculating GST', () => {
  const items = [
    { id: 8, name: 'Rice sack', sku: 'RICE-4', hsn: '1006', price: 400, qty: 1 }
  ];
  const ledgerFigures = pricing.computeTotals(items, 'FLAT50');
  const invoiceFigures = invoice.computeInvoiceFigures(order({
    items,
    coupon: 'FLAT50',
    subtotal: ledgerFigures.subtotal,
    discount: ledgerFigures.discount,
    tax: ledgerFigures.tax,
    total: ledgerFigures.total
  }));

  assert.deepEqual(
    { discount: ledgerFigures.discount, tax: ledgerFigures.tax, total: ledgerFigures.total },
    { discount: 50, tax: 17.5, total: 367.5 }
  );
  assert.deepEqual(
    { discount: invoiceFigures.discount, tax: invoiceFigures.tax, total: invoiceFigures.total },
    { discount: 50, tax: 17.5, total: 367.5 }
  );
});

test('invoice uses the same per-line GST rounding as pricing', () => {
  const items = [
    { id: 1, name: 'Sample A', sku: 'SAMPLE-A', hsn: '1006', price: 0.05, qty: 1, gstRate: 5 },
    { id: 2, name: 'Sample B', sku: 'SAMPLE-B', hsn: '1006', price: 0.05, qty: 1, gstRate: 5 },
    { id: 3, name: 'Sample C', sku: 'SAMPLE-C', hsn: '1006', price: 0.05, qty: 1, gstRate: 5 }
  ];
  const billed = pricing.computeTotals(items, '');
  const invoiceFigures = invoice.computeInvoiceFigures(order({
    items,
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    total: billed.total
  }));

  assert.deepEqual(
    { tax: billed.tax, cgst: billed.cgst, sgst: billed.sgst, total: billed.total },
    { tax: 0, cgst: 0, sgst: 0, total: 0.15 }
  );
  assert.deepEqual(
    {
      tax: invoiceFigures.tax,
      cgst: invoiceFigures.cgst,
      sgst: invoiceFigures.sgst,
      total: invoiceFigures.total,
      lineTaxes: invoiceFigures.rows.map(row => row.lineTax)
    },
    { tax: 0, cgst: 0, sgst: 0, total: 0.15, lineTaxes: [0, 0, 0] }
  );
});

test('GST reconciliation reports matching invoice and ledger figures from in-memory orders', () => {
  const activeOrder = order();
  const cancelledOrder = order({ id: 42, status: 'cancelled' });
  const result = reports.getGstReconciliation({ orders: [activeOrder, cancelledOrder] });

  assert.deepEqual(result, {
    totalChecked: 1,
    mismatchCount: 0,
    totalDelta: 0,
    rows: [{
      orderId: 41,
      date: '2026-11-21',
      customer: 'Test Customer',
      coupon: '',
      ledgerSubtotal: 200,
      ledgerDiscount: 0,
      ledgerTax: 10,
      ledgerTotal: 210,
      invoiceDiscount: 0,
      invoiceTax: 10,
      invoiceTotal: 210,
      delta: 0,
      matched: true
    }]
  });
});
