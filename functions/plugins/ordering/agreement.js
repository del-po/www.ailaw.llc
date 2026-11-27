// ==========================================================
// Ordering: the Legal Services Agreement (and invoice) as PDF blocks
// Client details that are missing are simply left out. When the payment
// method is "invoice", the invoice follows on a second page.
// ==========================================================

import { COMPANY, formatDate, money } from '../../core/app.js';

// Everything the documents need, from one order and its items
export function agreementData(order, items, bank) {
  const lines = (items.length ? items : [{ name: order.serviceName, quantity: 1, unitPrice: order.subtotal || order.total, discountAmount: order.discountTotal, lineTotal: order.total }])
    .map((i) => ({
      name: i.name,
      quantity: Number(i.quantity),
      unitPrice: money(i.unitPrice),
      discount: money(i.discountAmount),
      total: money(i.lineTotal),
    }));
  return {
    number: order.orderNumber,
    date: formatDate(order.createdAt, 'dd.MM.yyyy'),
    paymentMethod: order.paymentMethod || 'invoice',
    currency: order.currency || 'GEL',
    total: money(order.total),
    lines,
    bank,
    client: {
      name: String(order.customerName || '').trim(),
      code: String(order.clientId || '').trim(),
      passport: String(order.passport || '').trim(),
      idNumber: String(order.idNumber || '').trim(),
      address: String(order.address || order.billingAddress || '').trim(),
      email: String(order.customerEmail || '').trim(),
      phone: String(order.customerPhone || '').trim(),
    },
  };
}

// "Nino Beridze [Client Code: ID-…, Passport Number: …, E-mail: …]"
function clientLine(c) {
  const details = [
    c.code && 'Client Code: ' + c.code,
    c.passport && 'Passport Number: ' + c.passport,
    c.idNumber && 'ID Number: ' + c.idNumber,
    c.address && 'Address: ' + c.address,
    c.email && 'E-mail: ' + c.email,
  ].filter(Boolean);
  return (c.name || 'The Client') + (details.length ? ' [' + details.join(', ') + ']' : '');
}

// Service | Quantity | Unit price | Discount | Total, then the order total
function linesTable(d) {
  const rows = [['Service', 'Quantity', 'Unit price', 'Discount', 'Total']];
  d.lines.forEach((l) =>
    rows.push([l.name, String(l.quantity), l.unitPrice, Number(l.discount) > 0 ? '−' + l.discount : '—', l.total]),
  );
  rows.push([`Total (${d.currency})`, '', '', '', d.total]);
  return { table: rows, bold: [0, rows.length - 1], widths: [0.4, 0.12, 0.16, 0.16, 0.16] };
}

export function agreementBlocks(d) {
  const b = [
    { title: 'LEGAL SERVICES AGREEMENT № ' + d.number },
    { text: 'Date: ' + d.date },
    { text: 'Place: Tbilisi, Georgia' },
    { text: 'This Legal Services Agreement (hereinafter referred to as the “Agreement”) is entered into by and between:' },
    {
      text:
        `${COMPANY.name} [a limited liability company registered under the laws of Georgia, ` +
        `Identification Number: ${COMPANY.registration}, Legal Address: ${COMPANY.address}] ` +
        '(hereinafter referred to as the “Service Provider”),',
    },
    { text: 'AND' },
    { text: clientLine(d.client) + ' (hereinafter referred to as the “Client”).' },
    { text: 'The Client wishes to receive professional legal services, and the Service Provider agrees to provide them. Therefore, both parties agree to the following terms:' },

    { heading: 'Article 1: Subject Matter' },
    { text: '1.1. The subject of this Agreement is the provision of legal services by the Service Provider to the Client in exchange for the agreed fee.' },
    { text: '1.2. The legal services to be provided under this Agreement are specified in the Order Summary below, which forms an integral part of this Agreement.' },
    { text: '1.3. The Service Provider shall follow the lawful instructions of the Client.' },
    { text: '1.4. Communication and assignments between the Service Provider and the Client may be made orally or in writing, by official correspondence, by e-mail, or by any other means of communication.' },
    { text: '1.5. If necessary, and with the prior consent of the Client, the Service Provider may use the professional services of third parties (including a notary or a translator).' },

    { heading: 'Article 2: Professional Ethics' },
    { text: '2.1. The Service Provider shall provide legal services to the Client with the due diligence and fidelity inherent in the attorney-client relationship.' },
    { text: '2.2. The Service Provider agrees to consider any document and information entrusted to it regarding the legal services — whether written or oral — as confidential information and shall not disclose it without the prior consent of the Client. This obligation is indefinite and remains in force even after the termination of the Agreement.' },

    { heading: 'Article 3: Service Fee' },
    { text: `3.1. The fee to be paid by the Client for the legal services provided by the Service Provider shall be ${d.total} ${d.currency}, as set out in the Order Summary.` },
    { text: '3.2. The fee must be paid in advance.' },
  ];
  if (d.currency !== 'GEL') {
    b.push({ text: '3.3. If applicable mandatory legislation requires payment in domestic currency, the Client may pay the fee in Georgian Lari (GEL) calculated at the official exchange rate established by the National Bank of Georgia on the date of payment.' });
  }
  b.push(
    { heading: 'Article 4: Miscellaneous' },
    { text: '4.1. This Agreement is a legal agreement between the Parties. It is concluded electronically, enters into force when the Client confirms the order or pays the fee, whichever comes first, and is valid until the Parties fulfil their obligations.' },
    { text: '4.2. This document is executed in English, and an electronic copy shall be delivered to the Client.' },
    { text: '4.3. This Agreement shall be governed by and construed in accordance with the laws of Georgia, and the Parties submit to the exclusive jurisdiction of the Georgian courts, with any matters not explicitly regulated herein being governed by the substantive laws of Georgia.' },
    { heading: 'Order Summary' },
    linesTable(d),
    { heading: 'Parties' },
    {
      table: [
        ['Service Provider', 'Client'],
        [`${COMPANY.name}\n${COMPANY.signatory}`, (d.client.name || 'The Client') + (d.client.code ? '\n' + d.client.code : '')],
        ['Concluded electronically', 'Accepted electronically'],
      ],
      bold: [0],
    },
  );
  return b;
}

export function invoiceBlocks(d) {
  const c = d.client;
  const billTo = [c.name || 'The Client', c.code, [c.idNumber, c.passport].filter(Boolean).join(', '), c.address, c.email, c.phone]
    .filter(Boolean)
    .join('\n');
  const from = [`${COMPANY.name} | Professional Legal Services`, COMPANY.registration, COMPANY.address, COMPANY.phone, COMPANY.email, COMPANY.website].join('\n');
  return [
    { pageBreak: true },
    { title: 'INVOICE № ' + d.number },
    { text: 'Date: ' + d.date },
    { table: [['From', 'Bill to'], [from, billTo]], bold: [0] },
    { heading: 'Services' },
    linesTable(d),
    { heading: 'Payment details' },
    { text: 'Recipient: ' + d.bank.recipient },
    { text: 'IBAN (GEL, USD, EUR, GBP): ' + d.bank.iban },
    { text: 'Payment reference: ' + d.number },
    { text: `Amount due: ${d.total} ${d.currency}, payable in advance` },
  ];
}
