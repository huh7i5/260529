/**
 * nlp.js — Chinese natural language processing engine for VoiCal
 *
 * Parses spoken Chinese text into structured calendar commands.
 * Uses chrono-node (zh) for date/time extraction and regex-based
 * intent classification.
 *
 * Features:
 *  - Smart Time Correction: fixes conflicting period + hour combos
 *  - Recurring Events: 每天/每周X/每月X日/每个工作日
 */

import * as chrono from 'chrono-node';

// ──────────────────────────────────────────────
// Intent patterns (order matters – first match wins)
// ──────────────────────────────────────────────

const INTENT_PATTERNS = [
  {
    intent: 'RECURRING',
    pattern: /每天|每日|每周|每月|每个工作日/,
  },
  {
    intent: 'QUERY',
    pattern: /查询|查看|搜索|查找|有什么|什么安排|什么事|哪些|日程|有啥|几个|多少/,
  },
  {
    intent: 'DELETE',
    pattern: /删除|取消|移除|去掉/,
  },
  {
    intent: 'MODIFY',
    pattern: /修改|更改|调整|改到|改为/,
  },
  {
    intent: 'ADD',
    pattern: /添加|新建|新增|创建|安排一|设置|帮我加|记一下|加一个|帮我安排/,
  },
];

// ──────────────────────────────────────────────
// Chinese number helpers
// ──────────────────────────────────────────────

const CN_NUM_MAP = {
  '零': 0, '〇': 0,
  '一': 1, '壹': 1,
  '二': 2, '两': 2, '贰': 2,
  '三': 3, '叁': 3,
  '四': 4, '肆': 4,
  '五': 5, '伍': 5,
  '六': 6, '陆': 6,
  '七': 7, '柒': 7,
  '八': 8, '捌': 8,
  '九': 9, '玖': 9,
  '十': 10, '拾': 10,
};

/**
 * Convert a Chinese number string to an integer.
 * Handles simple cases like 三, 十二, 二十, 二十三.
 */
function chineseNumToInt(str) {
  if (!str) return NaN;
  const n = Number(str);
  if (!Number.isNaN(n)) return n;

  // Single character
  if (str.length === 1 && CN_NUM_MAP[str] !== undefined) {
    return CN_NUM_MAP[str];
  }

  let result = 0;
  const chars = [...str];

  // Pattern: X十Y  (e.g. 二十三 → 23)
  const shiIdx = chars.indexOf('十') !== -1
    ? chars.indexOf('十')
    : chars.indexOf('拾') !== -1
      ? chars.indexOf('拾')
      : -1;

  if (shiIdx !== -1) {
    const tens = shiIdx === 0 ? 1 : (CN_NUM_MAP[chars[shiIdx - 1]] ?? NaN);
    const ones = shiIdx === chars.length - 1 ? 0 : (CN_NUM_MAP[chars[shiIdx + 1]] ?? NaN);
    if (Number.isNaN(tens) || Number.isNaN(ones)) return NaN;
    result = tens * 10 + ones;
  } else {
    // Concatenate digit by digit (e.g. 一五 → 15)
    for (const ch of chars) {
      if (CN_NUM_MAP[ch] === undefined) return NaN;
      result = result * 10 + CN_NUM_MAP[ch];
    }
  }
  return result;
}

// ──────────────────────────────────────────────
// Time-period & relative-date helpers
// ──────────────────────────────────────────────

/**
 * Normalise period words (上午/下午/晚上/中午/早上) into hour offsets.
 * Returns the hour offset to add (0 or 12) plus a flag for special noon/evening logic.
 */
function periodToHourOffset(period) {
  switch (period) {
    case '早上':
    case '早晨':
    case '上午':
      return 0;   // AM hours are kept as-is
    case '中午':
      return 0;   // 中午 usually implies 12, handled separately
    case '下午':
      return 12;
    case '晚上':
    case '傍晚':
      return 12;
    default:
      return 0;
  }
}

/**
 * Check whether a period word implies PM (hour < 13 should get +12).
 */
function isPMPeriod(period) {
  return ['下午', '晚上', '傍晚'].includes(period);
}

// ──────────────────────────────────────────────
// Smart Time Correction
// ──────────────────────────────────────────────

/**
 * Period name → typical hour boundaries [min, max].
 * If the stated hour falls outside, we know something is off.
 */
const PERIOD_BOUNDS = {
  '凌晨': [0, 5],
  '早上': [5, 9],
  '早晨': [5, 9],
  '上午': [6, 12],
  '中午': [11, 13],
  '下午': [12, 18],
  '傍晚': [16, 19],
  '晚上': [18, 24],
};

/**
 * Fix conflicting period + hour combinations.
 *
 * Examples:
 *  - ('早上', 23) → { hour: 11, corrected: true, description: '早上23点→11点' }
 *  - ('下午', 3)  → { hour: 15, corrected: true, description: '下午3点→15:00' }
 *  - ('上午', 11) → { hour: 11, corrected: false }
 *  - ('早上', 13) → { hour: 13, corrected: true, description: '早上13点→13:00' }
 *
 * @param {string} period  Chinese period word (e.g. 早上, 下午, 晚上)
 * @param {number} hour    Hour value (0-23) as parsed
 * @returns {{ hour: number, corrected: boolean, description?: string }}
 */
export function correctTime(period, hour) {
  if (!period || hour == null || Number.isNaN(hour)) {
    return { hour, corrected: false };
  }

  const bounds = PERIOD_BOUNDS[period];
  if (!bounds) {
    return { hour, corrected: false };
  }

  const [lo, hi] = bounds;
  let correctedHour = hour;
  let corrected = false;
  let description;

  // Case 1: PM period but hour < 13 → add 12
  // e.g. 下午3点 → 15, 晚上7点 → 19
  if (isPMPeriod(period) && hour >= 1 && hour < 12) {
    correctedHour = hour + 12;
    corrected = true;
    description = `${period}${hour}点→${correctedHour}:00`;
  }
  // Case 2: AM period but impossibly high hour (>=20) → subtract 12
  // e.g. 早上23点 → user probably meant 11 AM
  else if (!isPMPeriod(period) && period !== '中午' && hour >= 20) {
    correctedHour = hour - 12;
    corrected = true;
    description = `${period}${hour}点→${correctedHour}:00`;
  }
  // Case 3: AM period but hour 13-19 → keep as-is (valid 24h), just flag
  // e.g. 早上13点 → 13:00 (probably meant 下午1点)
  else if (!isPMPeriod(period) && period !== '中午' && hour > 12 && hour <= 19) {
    corrected = true;
    description = `${period}${hour}点→${hour}:00（已按24小时制处理）`;
  }
  // Case 4: hour is within bounds, no correction needed

  return corrected
    ? { hour: correctedHour, corrected: true, description }
    : { hour, corrected: false };
}

/**
 * Post-process a chrono result to apply smart time corrections.
 * Detects period words in the original text near the parsed time span
 * and adjusts hours when conflicts are found.
 *
 * @param {string} originalText  The original input text
 * @param {object[]} chronoResults  Array of chrono ParsedResult
 * @returns {{ results: object[], correction: string|undefined }}
 */
function postProcessTimeCorrection(originalText, chronoResults) {
  if (!chronoResults || chronoResults.length === 0) {
    return { results: chronoResults, correction: undefined };
  }

  const periodRegex = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)/;
  const match = originalText.match(periodRegex);

  if (!match) {
    return { results: chronoResults, correction: undefined };
  }

  const period = match[1];
  const first = chronoResults[0];

  // Only correct if chrono assigned a definite hour
  if (!first.start.isCertain('hour')) {
    return { results: chronoResults, correction: undefined };
  }

  const parsedHour = first.start.get('hour');
  const result = correctTime(period, parsedHour);

  if (result.corrected) {
    first.start.assign('hour', result.hour);
    return { results: chronoResults, correction: result.description };
  }

  return { results: chronoResults, correction: undefined };
}

// ──────────────────────────────────────────────
// Pre-processing: normalise Chinese time expressions
// before feeding into chrono so it can better parse them.
// ──────────────────────────────────────────────

/**
 * Replace informal Chinese time expressions with something chrono
 * can reliably parse, or that we can pick up in post-processing.
 */
function preprocess(text) {
  let processed = text;

  // Normalise common time phrase shortcuts
  // "三点半" → "三点三十分"
  processed = processed.replace(
    /([零〇一二两三四五六七八九十百]+|\d+)点半/g,
    '$1点三十分',
  );

  // "三点一刻" → "三点十五分"
  processed = processed.replace(
    /([零〇一二两三四五六七八九十百]+|\d+)点一刻/g,
    '$1点十五分',
  );

  // "三点三刻" → "三点四十五分"
  processed = processed.replace(
    /([零〇一二两三四五六七八九十百]+|\d+)点三刻/g,
    '$1点四十五分',
  );

  return processed;
}

// ──────────────────────────────────────────────
// Core: detect intent
// ──────────────────────────────────────────────

function detectIntent(text) {
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(text)) {
      return intent;
    }
  }
  return 'UNKNOWN';
}

/**
 * Strip the intent keyword from the text so the rest can be used as a title
 * or further parsed.
 */
function stripIntentKeyword(text, intent) {
  for (const { intent: i, pattern } of INTENT_PATTERNS) {
    if (i === intent) {
      return text.replace(pattern, '').trim();
    }
  }
  return text.trim();
}

// ──────────────────────────────────────────────
// Date extraction wrappers
// ──────────────────────────────────────────────

/**
 * Try to parse dates/times from Chinese text using chrono.zh.
 * Returns the array of chrono ParsedResult objects.
 */
function extractDates(text, refDate) {
  const ref = refDate || new Date();
  const preprocessed = preprocess(text);
  return chrono.zh.parse(preprocessed, ref, { forwardDate: true });
}

/**
 * Build a query date range for QUERY intents.
 * Recognises: 今天, 明天, 后天, 本周/这周, 下周, 本月/这个月, 下个月
 */
function getQueryDateRange(text, refDate) {
  const now = refDate || new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  if (/今天|今日|当天/.test(text)) {
    return { start: todayStart, end: todayEnd };
  }

  if (/明天|明日/.test(text)) {
    const start = new Date(todayStart);
    start.setDate(start.getDate() + 1);
    const end = new Date(todayEnd);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  if (/后天/.test(text)) {
    const start = new Date(todayStart);
    start.setDate(start.getDate() + 2);
    const end = new Date(todayEnd);
    end.setDate(end.getDate() + 2);
    return { start, end };
  }

  if (/本周|这周|这一周/.test(text)) {
    const dayOfWeek = now.getDay() || 7; // Monday = 1
    const start = new Date(todayStart);
    start.setDate(start.getDate() - dayOfWeek + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59);
    return { start, end };
  }

  if (/下周|下一周/.test(text)) {
    const dayOfWeek = now.getDay() || 7;
    const start = new Date(todayStart);
    start.setDate(start.getDate() - dayOfWeek + 8); // next Monday
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59);
    return { start, end };
  }

  if (/本月|这个月|这月/.test(text)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }

  if (/下个月|下月/.test(text)) {
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    return { start, end };
  }

  // Fallback: try chrono parsing for an explicit date
  const parsed = extractDates(text, now);
  if (parsed.length > 0) {
    const start = parsed[0].start.date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59);
    return { start, end };
  }

  // Ultimate fallback → today
  return { start: todayStart, end: todayEnd };
}

// ──────────────────────────────────────────────
// Title extraction
// ──────────────────────────────────────────────

/**
 * Remove the date/time textual spans from the input so the remainder
 * can serve as the event title.
 */
function extractTitle(text, chronoResults) {
  let title = text;

  // Remove chrono-matched spans (in reverse order to keep indices valid)
  const sorted = [...chronoResults].sort((a, b) => b.index - a.index);
  for (const r of sorted) {
    title = title.slice(0, r.index) + title.slice(r.index + r.text.length);
  }

  // Remove common filler / connector words that often linger
  title = title
    .replace(/^[的,，、\s]+/, '')
    .replace(/[的,，、\s]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return title;
}

// ──────────────────────────────────────────────
// Recurring-event helpers
// ──────────────────────────────────────────────

const DAY_OF_WEEK_MAP = {
  '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '日': 0, '天': 0,
};

/**
 * Parse a RECURRING intent body and return recurrence metadata
 * plus the first occurrence date.
 *
 * @param {string} body      Text after intent-keyword stripping
 * @param {Date}   refDate   Reference date (usually now)
 * @returns {{ recurrence: object, startDate: Date, endDate: Date, title: string }}
 */
function parseRecurrence(body, refDate) {
  const now = refDate || new Date();
  let recurrence = null;
  let title = body;

  // ── 每天 / 每日 ──
  if (/每天|每日/.test(body)) {
    recurrence = { type: 'daily' };
    title = body.replace(/每天|每日/g, '').trim();
  }
  // ── 每个工作日 ──
  else if (/每个工作日/.test(body)) {
    recurrence = { type: 'weekdays' };
    title = body.replace(/每个工作日/g, '').trim();
  }
  // ── 每周X ──
  else if (/每周/.test(body)) {
    const m = body.match(/每周([一二三四五六日天])/);
    const dayOfWeek = m ? (DAY_OF_WEEK_MAP[m[1]] ?? 1) : 1;
    recurrence = { type: 'weekly', dayOfWeek };
    title = body.replace(/每周[一二三四五六日天]?/g, '').trim();
  }
  // ── 每月X日/号 ──
  else if (/每月/.test(body)) {
    const m = body.match(/每月([零〇一二两三四五六七八九十百]+|\d+)[日号]/);
    const dayOfMonth = m ? chineseNumToInt(m[1]) : 1;
    recurrence = { type: 'monthly', dayOfMonth: Number.isNaN(dayOfMonth) ? 1 : dayOfMonth };
    title = body.replace(/每月([零〇一二两三四五六七八九十百]+|\d+)[日号]?/g, '').trim();
  }

  // Extract time from remaining text
  const results = extractDates(title, now);
  let startDate;
  let endDate;

  if (results.length > 0) {
    startDate = results[0].start.date();
    if (!results[0].start.isCertain('hour')) {
      startDate.setHours(9, 0, 0, 0);
    }
    endDate = results[0].end
      ? results[0].end.date()
      : new Date(startDate.getTime() + 60 * 60 * 1000);
    title = extractTitle(title, results) || title;
  } else {
    // Default to 09:00
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  }

  // Calculate actual first occurrence
  if (recurrence) {
    if (recurrence.type === 'weekly' && recurrence.dayOfWeek != null) {
      const currentDay = now.getDay();
      let diff = recurrence.dayOfWeek - currentDay;
      if (diff < 0) diff += 7;
      if (diff === 0 && startDate.getTime() < now.getTime()) diff = 7;
      const firstDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      startDate.setFullYear(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
      endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    } else if (recurrence.type === 'monthly' && recurrence.dayOfMonth != null) {
      const firstDate = new Date(now.getFullYear(), now.getMonth(), recurrence.dayOfMonth);
      if (firstDate.getTime() < now.getTime()) {
        firstDate.setMonth(firstDate.getMonth() + 1);
      }
      startDate.setFullYear(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
      endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    } else if (recurrence.type === 'weekdays') {
      const currentDay = now.getDay();
      let diff = 0;
      if (currentDay === 0) diff = 1;
      else if (currentDay === 6) diff = 2;
      else if (startDate.getTime() < now.getTime()) {
        diff = currentDay === 5 ? 3 : 1;
      }
      if (diff > 0) {
        const firstDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        startDate.setFullYear(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      }
    }
    // daily: startDate is already today or next occurrence, fine as-is
  }

  // Clean up title
  title = title
    .replace(/[的,，、\s]+$/g, '')
    .replace(/^[的,，、\s]+/g, '')
    .trim() || '新事件';

  return { recurrence, startDate, endDate, title };
}

// ──────────────────────────────────────────────
// Main export: parseVoiceCommand
// ──────────────────────────────────────────────

/**
 * Parse a Chinese voice command string into a structured result.
 *
 * @param {string} text  Raw recognised text from the speech API.
 * @returns {{
 *   intent: 'ADD'|'DELETE'|'QUERY'|'MODIFY'|'RECURRING'|'UNKNOWN',
 *   title: string,
 *   startDate: Date|null,
 *   endDate: Date|null,
 *   originalText: string,
 *   correction?: string,
 *   recurrence?: { type: 'daily'|'weekly'|'monthly'|'weekdays', dayOfWeek?: number, dayOfMonth?: number },
 * }}
 */
export function parseVoiceCommand(text) {
  if (!text || typeof text !== 'string') {
    return { intent: 'UNKNOWN', title: '', startDate: null, endDate: null, originalText: text || '', correction: undefined };
  }

  const trimmed = text.trim();
  const originalText = trimmed;

  // 1. Detect intent
  let intent = detectIntent(trimmed);

  // 2. Strip intent keyword to get the "body"
  let body = intent !== 'UNKNOWN' ? stripIntentKeyword(trimmed, intent) : trimmed;

  const now = new Date();

  // 3. Branch on intent
  switch (intent) {
    // ── RECURRING ─────────────────────────────
    case 'RECURRING': {
      const { recurrence, startDate, endDate, title } = parseRecurrence(body, now);
      return { intent: 'RECURRING', title, startDate, endDate, originalText, recurrence };
    }

    // ── ADD ──────────────────────────────────
    case 'ADD': {
      const rawResults = extractDates(body, now);
      const { results, correction } = postProcessTimeCorrection(body, rawResults);
      let startDate;
      let endDate;

      if (results.length > 0) {
        const first = results[0];
        startDate = first.start.date();

        // If chrono didn't assign a definite time, default to 09:00
        if (!first.start.isCertain('hour')) {
          startDate.setHours(9, 0, 0, 0);
        }

        if (first.end) {
          endDate = first.end.date();
        } else {
          // Default end = start + 1 hour
          endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
        }
      } else {
        // No date detected → default to today 09:00
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      }

      const title = extractTitle(body, results) || body || '新事件';

      return { intent: 'ADD', title, startDate, endDate, originalText, correction };
    }

    // ── QUERY ────────────────────────────────
    case 'QUERY': {
      const range = getQueryDateRange(body, now);
      return {
        intent: 'QUERY',
        title: '',
        startDate: range.start,
        endDate: range.end,
        originalText,
        correction: undefined,
      };
    }

    // ── DELETE ───────────────────────────────
    case 'DELETE': {
      // The remaining body is the keyword to match against event titles
      const keyword = body
        .replace(/事件|日程|活动|安排/g, '')
        .trim();

      return {
        intent: 'DELETE',
        title: keyword || '',
        startDate: null,
        endDate: null,
        originalText,
        correction: undefined,
      };
    }

    // ── MODIFY ───────────────────────────────
    case 'MODIFY': {
      // Try to split around "改到 / 改为 / 调整到" to get title + new time
      const splitMatch = body.match(/(.+?)(?:改到|改为|调整到|调整为|更改为|更改到)(.+)/);

      let title = body;
      let startDate = null;
      let endDate = null;
      let correction;

      if (splitMatch) {
        title = splitMatch[1]
          .replace(/把|将|的时间|的日期/g, '')
          .trim();
        const timePart = splitMatch[2].trim();
        const rawResults = extractDates(timePart, now);
        const postProcessed = postProcessTimeCorrection(timePart, rawResults);
        const results = postProcessed.results;
        correction = postProcessed.correction;
        if (results.length > 0) {
          startDate = results[0].start.date();
          if (!results[0].start.isCertain('hour')) {
            startDate.setHours(9, 0, 0, 0);
          }
          endDate = results[0].end
            ? results[0].end.date()
            : new Date(startDate.getTime() + 60 * 60 * 1000);
        }
      } else {
        // Fallback: try to extract dates from the whole body
        const rawResults = extractDates(body, now);
        const postProcessed = postProcessTimeCorrection(body, rawResults);
        const results = postProcessed.results;
        correction = postProcessed.correction;
        if (results.length > 0) {
          title = extractTitle(body, results) || body;
          startDate = results[0].start.date();
          if (!results[0].start.isCertain('hour')) {
            startDate.setHours(9, 0, 0, 0);
          }
          endDate = results[0].end
            ? results[0].end.date()
            : new Date(startDate.getTime() + 60 * 60 * 1000);
        }
      }

      return { intent: 'MODIFY', title, startDate, endDate, originalText, correction };
    }

    // ── UNKNOWN → heuristic: maybe an implicit ADD? ─
    default: {
      // If the text contains a recognisable date and some leftover text,
      // treat it as an ADD command.
      const rawResults = extractDates(trimmed, now);
      const { results, correction } = postProcessTimeCorrection(trimmed, rawResults);
      if (results.length > 0) {
        const title = extractTitle(trimmed, results) || trimmed;
        // Only promote to ADD if there's actually a title left
        if (title.length > 0) {
          let startDate = results[0].start.date();
          if (!results[0].start.isCertain('hour')) {
            startDate.setHours(9, 0, 0, 0);
          }
          const endDate = results[0].end
            ? results[0].end.date()
            : new Date(startDate.getTime() + 60 * 60 * 1000);

          return { intent: 'ADD', title, startDate, endDate, originalText, correction };
        }
      }

      return { intent: 'UNKNOWN', title: trimmed, startDate: null, endDate: null, originalText, correction: undefined };
    }
  }
}

// ──────────────────────────────────────────────
// Export: getDateDescription
// ──────────────────────────────────────────────

/**
 * Return a human-friendly Chinese description of a Date object.
 * Examples: "今天下午3点", "明天上午9点30分", "6月5日晚上8点"
 *
 * @param {Date} date
 * @returns {string}
 */
export function getDateDescription(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '未知时间';
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((targetStart - todayStart) / (1000 * 60 * 60 * 24));

  // ── Day part ──
  let dayStr;
  switch (diffDays) {
    case -2: dayStr = '前天'; break;
    case -1: dayStr = '昨天'; break;
    case 0:  dayStr = '今天'; break;
    case 1:  dayStr = '明天'; break;
    case 2:  dayStr = '后天'; break;
    default:
      dayStr = `${date.getMonth() + 1}月${date.getDate()}日`;
      break;
  }

  // ── Period part ──
  const hour = date.getHours();
  let period;
  if (hour < 6) {
    period = '凌晨';
  } else if (hour < 9) {
    period = '早上';
  } else if (hour < 12) {
    period = '上午';
  } else if (hour === 12) {
    period = '中午';
  } else if (hour < 18) {
    period = '下午';
  } else {
    period = '晚上';
  }

  // ── Time part ──
  const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  const minutes = date.getMinutes();
  const timeStr = minutes > 0
    ? `${displayHour}点${minutes}分`
    : `${displayHour}点`;

  return `${dayStr}${period}${timeStr}`;
}
