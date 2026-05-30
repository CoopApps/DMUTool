'use strict';

const fetch = require('node-fetch');

const USER_AGENT = 'DMU-ParliamentaryIntelligence/1.0';
const TIMEOUT = parseInt(process.env.HTTP_TIMEOUT_MS || '20000', 10);

/** Sleep helper for rate limiting. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch JSON with the tool's User-Agent. Throws on non-2xx.
 */
async function getJson(url, opts = {}) {
  const res = await fetch(url, {
    timeout: TIMEOUT,
    ...opts,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Fetch raw text (HTML / Atom / XML) with the tool's User-Agent.
 * Returns { ok, status, text }.
 */
async function getText(url, opts = {}) {
  const res = await fetch(url, {
    timeout: TIMEOUT,
    ...opts,
    headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
  });
  const text = res.ok ? await res.text() : '';
  return { ok: res.ok, status: res.status, text };
}

module.exports = { fetch, getJson, getText, sleep, USER_AGENT };
