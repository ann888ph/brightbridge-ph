/* topic-validation.js - BrightBridge PH
   Shared, pure custom-topic validation logic. No DOM/browser APIs, no
   Node-only APIs -- this file is loaded two ways with zero build step:
     - Browser: <script src="topic-validation.js"> before app.js, exposes
       window.TopicValidation for instant client-side UX feedback.
     - Netlify Function: require('../../topic-validation.js') from
       netlify/functions/generate.js, where it is the SERVER-AUTHORITATIVE
       gate before any worksheet request (catalog or custom topic) reserves
       quota or reaches the Anthropic API.
   Keeping this as ONE file (instead of two copies) is the whole point: the
   client and server must never independently drift on what counts as a
   valid topic. A custom topic is a user-provided LABEL, never a trusted
   instruction -- see the REJECTED reasons below. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TopicValidation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

var MIN_LENGTH = 3;
// Validation now runs UNCONDITIONALLY on every topic, catalog or custom
// (topicSource is client-asserted and never trusted as a reason to skip
// this check -- see generate.js). That means the length cap must also be
// safe for genuine catalog topics, not just short parent-typed labels.
// Ground truth: extracting every topic string from all 6
// grade{N}-topics.json files (936 topics total) found a real max length
// of 121 characters (official, verbose DepEd MATATAG topic titles like
// "Organizing Information from Secondary Sources in Preparation for
// Writing, Reporting, or Similar Academic Tasks in English"). 80 would
// have rejected 29 of those 936 topics outright. 150 gives headroom for
// future catalog additions while remaining "a short topic/phrase," not a
// paragraph. This is capacity/hygiene, NOT the injection defense -- actual
// attack detection (phrase patterns, HTML-tag shape, URLs, control chars,
// multiline) is unchanged and does not depend on this number.
var MAX_LENGTH = 150;

function normalizeWhitespace(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

// Requires a letter immediately after '<' (optionally after a slash) --
// matches real tags like <script>, <img ...>, </div>, but NOT a legitimate
// topic that happens to use bare < / > as math symbols (e.g. "Comparing
// numbers using < and >").
var HTML_TAG_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?>/;

var URL_PATTERN = /https?:\/\/|www\.[^\s]+|\b[a-z0-9-]+\.(com|net|org|ph|io|co|gov)\b/i;

// Built from numeric char codes at runtime (not written as literal escape
// sequences in source) to guarantee this file stays 100% ASCII on disk --
// see the project's ASCII-only convention. Matches C0 control characters
// (0-31, excluding tab/newline/CR which are handled separately above) plus
// DEL (127).
var CONTROL_CHAR_CODES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 127];
var CONTROL_CHAR_PATTERN = new RegExp('[' + CONTROL_CHAR_CODES.map(function (c) { return String.fromCharCode(c); }).join('') + ']');

// Common prompt-injection phrasings. Intentionally a short, targeted
// allowlist-of-rejections rather than a broad heuristic -- false positives
// here block a legitimate parent/teacher from generating a worksheet, so
// each pattern targets a specific, well-known injection phrasing rather
// than guessing at "instruction-like" tone in general.
var INJECTION_PATTERNS = [
  /ignore\s+(all|any|previous|prior|above)\s+instructions?/i,
  /disregard\s+(all|any|previous|prior|above)/i,
  /reveal\s+(your|the)\s+(prompt|instructions|system)/i,
  /system\s*prompt/i,
  /you\s+are\s+(now|actually)\s/i,
  /act\s+as\s+(a|an|if)/i,
  /\bjavascript:/i
];

// Matches a string made ENTIRELY of whitespace/punctuation/symbols (e.g.
// "...", "???", "----"), with no actual word content.
var PUNCTUATION_ONLY_PATTERN = /^[\s\p{P}\p{S}]+$/u;

/**
 * Validates a user-provided custom topic string. Pure function, no I/O.
 * Returns { ok: true, normalized } or { ok: false, reason }.
 *
 * `reason` is one of: 'empty', 'too_short', 'too_long', 'multiline',
 * 'control_characters', 'punctuation_only', 'url', 'html_markup',
 * 'injection_like'.
 */
function validateCustomTopic(rawText) {
  var original = String(rawText == null ? '' : rawText);

  if (/\r|\n/.test(original)) {
    return { ok: false, reason: 'multiline' };
  }
  if (CONTROL_CHAR_PATTERN.test(original)) {
    return { ok: false, reason: 'control_characters' };
  }

  var normalized = normalizeWhitespace(original);

  if (normalized.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (normalized.length < MIN_LENGTH) {
    return { ok: false, reason: 'too_short' };
  }
  if (normalized.length > MAX_LENGTH) {
    return { ok: false, reason: 'too_long' };
  }
  if (PUNCTUATION_ONLY_PATTERN.test(normalized)) {
    return { ok: false, reason: 'punctuation_only' };
  }
  if (HTML_TAG_PATTERN.test(normalized)) {
    return { ok: false, reason: 'html_markup' };
  }
  if (URL_PATTERN.test(normalized)) {
    return { ok: false, reason: 'url' };
  }
  for (var i = 0; i < INJECTION_PATTERNS.length; i++) {
    if (INJECTION_PATTERNS[i].test(normalized)) {
      return { ok: false, reason: 'injection_like' };
    }
  }

  return { ok: true, normalized: normalized };
}

var FRIENDLY_MESSAGES = {
  empty: 'Please enter a short lesson topic.',
  too_short: 'Please enter a slightly longer topic (at least 3 characters).',
  too_long: 'Please shorten your topic to 150 characters or fewer -- a short lesson name or phrase works best.',
  multiline: 'Please enter a single short topic, not multiple lines.',
  control_characters: 'That topic contains characters we can\'t use. Please type a plain lesson topic.',
  punctuation_only: 'Please enter a topic using words, not just punctuation.',
  html_markup: 'Please enter a short lesson topic without links, code, or instructions.',
  url: 'Please enter a short lesson topic without links, code, or instructions.',
  injection_like: 'Please enter a short lesson topic without links, code, or instructions.'
};

function friendlyMessageFor(reason) {
  return FRIENDLY_MESSAGES[reason] || FRIENDLY_MESSAGES.html_markup;
}

/**
 * Finds catalog topics whose text is a close match to the given query.
 * Pure client-side convenience for search-as-you-type suggestions -- not
 * a security boundary, so a simple case-insensitive substring/word-overlap
 * score is enough for V1 (no fuzzy-matching library, no server round trip).
 */
function findTopicSuggestions(query, topicList, maxResults) {
  var q = normalizeWhitespace(query).toLowerCase();
  if (!q || !Array.isArray(topicList)) return [];

  var limit = maxResults || 5;
  var qWords = q.split(' ').filter(Boolean);

  var scored = [];
  for (var i = 0; i < topicList.length; i++) {
    var topic = topicList[i];
    var tl = String(topic).toLowerCase();
    var score = 0;
    if (tl === q) {
      score = 100;
    } else if (tl.indexOf(q) !== -1 || q.indexOf(tl) !== -1) {
      score = 80;
    } else {
      var matches = 0;
      for (var w = 0; w < qWords.length; w++) {
        if (tl.indexOf(qWords[w]) !== -1) matches++;
      }
      score = matches > 0 ? (matches / qWords.length) * 60 : 0;
    }
    if (score > 0) scored.push({ topic: topic, score: score });
  }

  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, limit).map(function (s) { return s.topic; });
}

return {
  MIN_LENGTH: MIN_LENGTH,
  MAX_LENGTH: MAX_LENGTH,
  normalizeWhitespace: normalizeWhitespace,
  validateCustomTopic: validateCustomTopic,
  friendlyMessageFor: friendlyMessageFor,
  findTopicSuggestions: findTopicSuggestions
};
});
