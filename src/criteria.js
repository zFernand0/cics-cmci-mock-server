/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const { CmciError } = require('./cmci');

function matchesPattern(value, pattern) {
  const text = String(value).toUpperCase();
  const pieces = pattern.toUpperCase().split('*');
  if (pieces.length === 1) return text === pieces[0];
  const prefix = pieces.shift();
  const suffix = pieces.pop();
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return false;
  let position = prefix.length;
  const end = text.length - suffix.length;
  for (const piece of pieces) {
    position = text.indexOf(piece, position);
    if (position < 0) return false;
    position += piece.length;
  }
  return position <= end;
}

// Deliberately limited grammar: equality, quoted values, wildcards, AND and parentheses.
// Unsupported syntax fails explicitly instead of returning unfiltered data.
function parseCriteria(value) {
  if (value === undefined) return () => true;
  if (value.length > 4096) throw new CmciError(400, 'INVALIDPARM', 'CRITERIA is too long');
  let rest = value.trim();
  const invalid = () => { throw new CmciError(400, 'INVALIDPARM', 'Unsupported CRITERIA expression'); };
  function term(depth) {
    if (depth > 32) invalid();
    if (rest.startsWith('(')) {
      rest = rest.slice(1).trimStart();
      const result = expression(depth + 1);
      if (!rest.startsWith(')')) invalid();
      rest = rest.slice(1).trimStart();
      return result;
    }
    const match = /^([a-z_][a-z\d_]*)\s*={1,2}\s*(?:'([^']*)'|"([^"]*)"|([^\s()=]+))/i.exec(rest);
    if (!match) invalid();
    rest = rest.slice(match[0].length).trimStart();
    const field = match[1].toLowerCase();
    const pattern = match[2] ?? match[3] ?? match[4];
    return record => Object.hasOwn(record, field) && matchesPattern(record[field], pattern);
  }
  function expression(depth) {
    const terms = [term(depth)];
    while (/^AND\b/i.test(rest)) {
      rest = rest.slice(3).trimStart();
      terms.push(term(depth));
    }
    return record => terms.every(predicate => predicate(record));
  }
  const predicate = expression(0);
  if (rest) invalid();
  return predicate;
}

function parseGroup(parameter) {
  if (parameter === undefined) return undefined;
  const match = /^CSDGROUP\(([a-z\d@$#]{1,8})\)$/i.exec(parameter);
  if (!match) throw new CmciError(400, 'INVALIDPARM', 'Only PARAMETER=CSDGROUP(group) is supported in stateful mode');
  return match[1].toUpperCase();
}

module.exports = { parseCriteria, parseGroup };
