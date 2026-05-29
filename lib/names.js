'use strict';

/**
 * Normalise a person's name for cross-source matching: lower-case, strip
 * titles/honorifics and post-nominals, collapse whitespace, drop punctuation.
 * "Prof. Jane A. Smith-Jones OBE" -> "jane smith-jones".
 */
const TITLES = /\b(prof(essor)?|dr|mr|mrs|ms|miss|sir|dame|rev|hon)\.?\b/gi;
const POSTNOMINALS = /\b(obe|mbe|cbe|phd|msc|ba|bsc|ma|frcs|frcp|qc|kc|mp)\b/gi;

function normName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(TITLES, ' ')
    .replace(POSTNOMINALS, ' ')
    .replace(/[.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normName };
