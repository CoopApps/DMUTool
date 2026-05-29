'use strict';

/**
 * Morning email digest. Summarises new parliamentary items, new committee
 * inquiries and government consultations, and approaching deadlines, then
 * sends via SMTP (nodemailer). Configured entirely through .env; skips
 * gracefully (logged) when SMTP or recipients are absent.
 *
 * Required env: SMTP_HOST, SMTP_PORT, DIGEST_TO. Optional: SMTP_USER,
 * SMTP_PASS, SMTP_SECURE, DIGEST_FROM.
 */

const nodemailer = require('nodemailer');
const { all, logFetch } = require('../db/database');
const { esc } = require('../lib/render');

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.DIGEST_TO);
}

function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: process.env.SMTP_SECURE === '1' || parseInt(process.env.SMTP_PORT, 10) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

function gather() {
  const newItems = all(
    `SELECT source, keyword_group, title, member_name, date, url FROM parliamentary_items
     WHERE is_new = 1 OR created_at >= datetime('now','-1 day')
     ORDER BY keyword_group, date DESC LIMIT 40`
  );
  const newInquiries = all(
    `SELECT committee_name, inquiry_title, working_days_remaining, deadline, url
     FROM committee_inquiries WHERE evidence_status='AcceptingEvidence'
       AND (is_new = 1 OR working_days_remaining BETWEEN 0 AND 7)
     ORDER BY working_days_remaining ASC LIMIT 20`
  );
  const newCons = all(
    `SELECT organisation, title, working_days_remaining, deadline, url FROM consultations
     WHERE (deadline IS NULL OR date(deadline) >= date('now'))
       AND (is_new = 1 OR working_days_remaining BETWEEN 0 AND 7)
     ORDER BY working_days_remaining ASC LIMIT 20`
  );
  return { newItems, newInquiries, newCons };
}

function buildHtml({ newItems, newInquiries, newCons }) {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  const section = (title, rows) =>
    rows.length ? `<h2 style="font-size:16px;margin:18px 0 6px">${title}</h2>${rows.join('')}` : '';

  const itemRows = newItems.map((i) =>
    `<p style="margin:4px 0"><b>[${esc(i.source)}]</b> <a href="${esc(i.url)}">${esc(i.title)}</a>
     <span style="color:#667">— ${esc(i.keyword_group || '')}${i.member_name ? ' · ' + esc(i.member_name) : ''}</span></p>`);
  const inqRows = newInquiries.map((q) =>
    `<p style="margin:4px 0"><b>${esc(q.committee_name)}:</b> <a href="${esc(q.url)}">${esc(q.inquiry_title)}</a>
     <span style="color:#c62828">— ${q.working_days_remaining != null ? q.working_days_remaining + ' working days' : 'deadline TBC'}</span></p>`);
  const consRows = newCons.map((c) =>
    `<p style="margin:4px 0"><b>${esc(c.organisation || 'GOV.UK')}:</b> <a href="${esc(c.url)}">${esc(c.title)}</a>
     <span style="color:#c62828">— ${c.working_days_remaining != null ? c.working_days_remaining + ' working days' : 'closes ' + esc((c.deadline||'').slice(0,10))}</span></p>`);

  return `<div style="font-family:Arial,sans-serif;max-width:680px;color:#1c2333">
    <h1 style="font-size:20px;color:#0a1f44">DMU Parliamentary Intelligence — morning digest</h1>
    <p style="color:#667">${new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</p>
    ${section('New parliamentary activity', itemRows)}
    ${section('Committee inquiries — new or closing within 7 days', inqRows)}
    ${section('Government consultations — new or closing within 7 days', consRows)}
    ${(!itemRows.length && !inqRows.length && !consRows.length) ? '<p>No new activity in the last 24 hours.</p>' : ''}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e2e5ea">
    <p><a href="${base}/digest">Open the full digest →</a></p>
  </div>`;
}

async function sendDigest() {
  const started_at = new Date().toISOString();
  if (!isConfigured()) {
    logFetch({ source: 'email', started_at, completed_at: new Date().toISOString(),
      items_fetched: 0, items_new: 0, error: 'SMTP/DIGEST_TO not configured — email digest skipped.' });
    return { sent: false, skipped: true };
  }
  try {
    const data = gather();
    const total = data.newItems.length + data.newInquiries.length + data.newCons.length;
    const info = await transport().sendMail({
      from: process.env.DIGEST_FROM || process.env.SMTP_USER || 'dmu-intel@localhost',
      to: process.env.DIGEST_TO,
      subject: `DMU Parliamentary digest — ${total} item${total === 1 ? '' : 's'} (${new Date().toLocaleDateString('en-GB')})`,
      html: buildHtml(data),
    });
    logFetch({ source: 'email', started_at, completed_at: new Date().toISOString(),
      items_fetched: total, items_new: total, error: null });
    return { sent: true, messageId: info.messageId, total };
  } catch (e) {
    logFetch({ source: 'email', started_at, completed_at: new Date().toISOString(),
      items_fetched: 0, items_new: 0, error: e.message });
    return { sent: false, error: e.message };
  }
}

/** Send an HTML email via the configured SMTP transport. */
async function sendMail({ subject, html, to }) {
  if (!isConfigured()) throw new Error('SMTP/DIGEST_TO not configured');
  return transport().sendMail({
    from: process.env.DIGEST_FROM || process.env.SMTP_USER || 'dmu-intel@localhost',
    to: to || process.env.DIGEST_TO,
    subject,
    html,
  });
}

module.exports = { sendDigest, sendMail, isConfigured };
