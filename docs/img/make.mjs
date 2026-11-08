// Builds the two README diagrams in this folder: two-tiers.svg and webhook-flow.svg.
// Node built-ins only. Same script, same bytes: no clock, no randomness, no network.
// The tier numbers come from lib/email-breaker.js, so the chart cannot drift from the code.
// Run from the repo root: node docs/img/make.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BREAKER_DEFAULTS, breakerVerdict } from '../../lib/email-breaker.js';

const OUT = dirname(fileURLToPath(import.meta.url));

// The palette and type from the visual brand guide. No other colors appear in the output.
const NAVY = '#001B3B';
const SAND = '#EDE7DC';
const TERRACOTTA = '#8C5348';
const OLIVE = '#59591D';
const HEAD = '#F2EDE2';
const SUB = '#D8D3CA';
const SERIF = "Georgia, 'Playfair Display', serif";
const SANS = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const W = 1200;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function text(x, y, s, o = {}) {
  const a = [`x="${num(x)}"`, `y="${num(y)}"`, `font-family="${o.serif ? SERIF : SANS}"`, `font-size="${o.size || 18}"`];
  if (o.bold) a.push('font-weight="700"');
  if (o.anchor) a.push(`text-anchor="${o.anchor}"`);
  a.push(`fill="${o.fill || SUB}"`);
  return `<text ${a.join(' ')}>${esc(s)}</text>`;
}

function rect(x, y, w, h, o = {}) {
  const a = [`x="${num(x)}"`, `y="${num(y)}"`, `width="${num(w)}"`, `height="${num(h)}"`];
  if (o.rx) a.push(`rx="${o.rx}"`);
  a.push(`fill="${o.fill || 'none'}"`);
  if (o.stroke) a.push(`stroke="${o.stroke}"`, `stroke-width="${o.sw || 1}"`);
  if (o.dash) a.push(`stroke-dasharray="${o.dash}"`);
  return `<rect ${a.join(' ')}/>`;
}

function line(x1, y1, x2, y2, o = {}) {
  const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : '';
  return `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${o.stroke || SUB}" stroke-width="${o.sw || 1}"${dash}/>`;
}

function circle(cx, cy, r, o = {}) {
  const s = o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"` : '';
  return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${r}" fill="${o.fill || 'none'}"${s}/>`;
}

// A straight arrow with a drawn head (no markers, so every renderer draws it the same).
function arrow(x1, y1, x2, y2, o = {}) {
  const stroke = o.stroke || SAND;
  const head = o.head || 12;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const px = -uy * head * 0.5;
  const py = ux * head * 0.5;
  return [
    line(x1, y1, bx, by, { stroke, sw: o.sw || 2, dash: o.dash }),
    `<polygon points="${num(x2)},${num(y2)} ${num(bx + px)},${num(by + py)} ${num(bx - px)},${num(by - py)}" fill="${stroke}"/>`,
  ];
}

function svg(h, title, desc, body) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${esc(title)}</title>`,
    `<desc id="desc">${esc(desc)}</desc>`,
    rect(0.5, 0.5, W - 1, h - 1, { fill: NAVY, stroke: SAND }),
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

function twoTiers() {
  const H = 505;
  const X0 = 120;
  const X1 = 1100;
  const Y0 = 430; // 0%
  const Y1 = 130; // 8%
  const px = (sends) => X0 + (sends / 400) * (X1 - X0);
  const py = (pct) => Y0 - (pct / 8) * (Y0 - Y1);
  const { warnMin, stopMin } = BREAKER_DEFAULTS;
  const warnPct = BREAKER_DEFAULTS.warnPct * 100;
  const stopPct = BREAKER_DEFAULTS.stopPct * 100;

  // The two example windows, checked against the real breaker before they are drawn.
  const examples = [
    { sent: 100, hard: 2, tier: 'warn' },
    { sent: 250, hard: 13, tier: 'stop' },
  ];
  for (const e of examples) {
    const v = breakerVerdict({ sentInWindow: e.sent, hardBounced: e.hard });
    if (v.tier !== e.tier) throw new Error(`${e.hard} of ${e.sent} gave ${v.tier}, expected ${e.tier}`);
  }

  const b = [];
  b.push(text(40, 56, `Warn at ${warnPct}% after ${warnMin} sends. Stop at ${stopPct}% after ${stopMin}.`, { serif: true, size: 30, fill: HEAD }));
  b.push(text(40, 86, 'Hard or unknown bounces as a share of sends in the window. Both boundaries are inclusive.', { size: 18 }));
  b.push(text(X0, 118, 'hard bounce rate', { size: 17 }));

  for (const pct of [2, 4, 6, 8]) b.push(line(X0, py(pct), X1, py(pct), { stroke: SUB, dash: '3 6' }));

  // Zones: warn from 100 sends at 2%, stop from 250 sends at 5%. Everything else is none.
  b.push(rect(px(warnMin), py(8), px(400) - px(warnMin), py(warnPct) - py(8), { fill: OLIVE }));
  b.push(rect(px(stopMin), py(8), px(400) - px(stopMin), py(stopPct) - py(8), { fill: TERRACOTTA }));

  b.push(line(X0, Y0, X1, Y0, { stroke: SAND }));
  b.push(line(X0, Y1, X0, Y0, { stroke: SAND }));
  for (const pct of [0, 2, 4, 6, 8]) {
    b.push(line(X0 - 6, py(pct), X0, py(pct), { stroke: SAND }));
    b.push(text(X0 - 12, py(pct) + 6, `${pct}%`, { size: 17, anchor: 'end' }));
  }
  for (const s of [0, 100, 200, 300, 400]) {
    b.push(line(px(s), Y0, px(s), Y0 + 6, { stroke: SAND }));
    b.push(text(px(s), Y0 + 26, String(s), { size: 17, anchor: 'middle' }));
  }
  b.push(text((X0 + X1) / 2, Y0 + 56, 'sends in the window', { size: 18, anchor: 'middle' }));

  b.push(text(X0 + 20, 240, 'NONE', { size: 22, bold: true, fill: HEAD }));
  b.push(text(X0 + 20, 264, `under ${warnMin} sends`, { size: 18 }));
  b.push(text(880, 392, 'NONE', { size: 22, bold: true, fill: HEAD }));
  b.push(text(880, 416, `under ${warnPct}%`, { size: 18 }));
  b.push(text(px(warnMin) + 20, 170, 'WARN', { size: 22, bold: true, fill: HEAD }));
  b.push(text(px(warnMin) + 20, 196, 'keep sending', { size: 18, fill: HEAD }));
  b.push(text(X1 - 16, 166, 'STOP', { size: 22, bold: true, fill: HEAD, anchor: 'end' }));
  b.push(text(X1 - 16, 192, 'pause the campaign', { size: 18, fill: HEAD, anchor: 'end' }));

  const [warn, stop] = examples;
  const wx = px(warn.sent);
  const wy = py((warn.hard / warn.sent) * 100);
  b.push(circle(wx, wy, 9, { fill: HEAD, stroke: NAVY, sw: 2 }));
  b.push(text(wx + 18, 390, '2 of 100 = 2%, warn', { size: 19, bold: true, fill: HEAD }));
  b.push(text(wx + 18, 414, 'on the boundary, so it counts', { size: 17 }));

  const sx = px(stop.sent);
  const sy = py((stop.hard / stop.sent) * 100);
  b.push(circle(sx, sy, 9, { fill: HEAD, stroke: NAVY, sw: 2 }));
  b.push(text(sx + 20, sy - 7, '13 of 250 = 5.2%, stop', { size: 19, bold: true, fill: HEAD }));

  return svg(
    H,
    'Two tiers: warn at 2% after 100 sends, stop at 5% after 250',
    'Sends in the window from 0 to 400 against hard bounce rate from 0 to 8%, with a warn zone from 100 sends at 2%, a stop zone from 250 sends at 5%, and two examples: 2 of 100 warns and 13 of 250 stops.',
    b,
  );
}

function webhookFlow() {
  const H = 470;
  const b = [];
  b.push(text(40, 56, 'Read the field the provider actually sends.', { serif: true, size: 30, fill: HEAD }));
  b.push(text(40, 86, 'The webhook and the send loop classify through one reader, so the two cannot drift apart.', { size: 18 }));

  b.push(rect(40, 190, 230, 100, { rx: 4, stroke: SAND }));
  b.push(text(155, 232, 'Resend webhook', { size: 20, bold: true, fill: HEAD, anchor: 'middle' }));
  b.push(text(155, 260, 'email.bounced', { size: 18, anchor: 'middle' }));
  b.push(...arrow(270, 240, 319, 240));

  b.push(rect(320, 190, 280, 100, { rx: 4, stroke: SAND, sw: 2 }));
  b.push(text(460, 232, 'readBounce(data)', { size: 20, bold: true, fill: HEAD, anchor: 'middle' }));
  b.push(text(460, 260, 'reads data.bounce.type', { size: 18, anchor: 'middle' }));

  const outcomes = [
    { cy: 154, fill: TERRACOTTA, head: 'permanent: hard', sub: 'suppressed, and counts toward the breaker', subFill: HEAD },
    { cy: 240, fill: OLIVE, head: 'no type: unknown', sub: 'counts toward the breaker, not suppressed', subFill: HEAD },
    { cy: 326, stroke: SAND, head: 'transient: full mailbox, greylisting', sub: 'never counts, never suppressed', subFill: SUB },
  ];
  for (const o of outcomes) {
    b.push(...arrow(600, 240, 679, o.cy));
    b.push(rect(680, o.cy - 38, 480, 76, { rx: 4, fill: o.fill, stroke: o.stroke }));
    b.push(text(704, o.cy - 6, o.head, { size: 20, bold: true, fill: HEAD }));
    b.push(text(704, o.cy + 22, o.sub, { size: 18, fill: o.subFill }));
  }

  // The old read: the flat field the provider never sent.
  b.push(line(155, 290, 155, 400, { stroke: SUB, dash: '6 5' }));
  b.push(...arrow(155, 400, 319, 400, { stroke: SUB, sw: 1, dash: '6 5', head: 10 }));
  b.push(text(460, 360, 'the old flat read', { size: 17, anchor: 'middle' }));
  b.push(rect(320, 370, 280, 60, { rx: 4, stroke: SUB, dash: '6 5' }));
  b.push(text(460, 407, 'data.bounce_type', { size: 20, anchor: 'middle' }));
  b.push(line(355, 401, 565, 401, { stroke: TERRACOTTA, sw: 3 }));
  b.push(text(620, 407, 'empty for four months', { size: 19, bold: true, fill: HEAD }));

  return svg(
    H,
    'How a bounce webhook is read',
    'The Resend email.bounced webhook goes through readBounce, which reads data.bounce.type: a hard bounce is suppressed and counted, an unknown one is counted, a transient one never counts, and the old flat read of data.bounce_type is crossed out as empty for four months.',
    b,
  );
}

writeFileSync(join(OUT, 'two-tiers.svg'), twoTiers());
writeFileSync(join(OUT, 'webhook-flow.svg'), webhookFlow());
console.log('wrote two-tiers.svg and webhook-flow.svg');
