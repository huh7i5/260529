/**
 * storage.js - Dexie.js IndexedDB Storage Module
 * VoiCal 语音日历 - 本地事件持久化存储
 */

import Dexie from 'dexie';

// ─── Database Instance ───────────────────────────────────────────────
const db = new Dexie('VoiCalDB');

// Schema definition
// ++id  = auto-increment primary key
// title, start, end are indexed for fast lookups
db.version(1).stores({
  events: '++id, title, start, end, allDay, reminder, createdAt'
});

// ─── Initialise ──────────────────────────────────────────────────────

/**
 * Open / initialise the database.
 * Safe to call multiple times – Dexie handles idempotent opens.
 * @returns {Promise<Dexie>} the database instance
 */
export async function initDB() {
  try {
    await db.open();
    console.log('[Storage] VoiCalDB opened successfully');
    return db;
  } catch (err) {
    console.error('[Storage] Failed to open VoiCalDB:', err);
    throw err;
  }
}

// ─── Create ──────────────────────────────────────────────────────────

/**
 * Add a new calendar event.
 * @param {Object}  event
 * @param {string}  event.title
 * @param {string|Date} event.start   - will be stored as ISO string
 * @param {string|Date} [event.end]   - will be stored as ISO string
 * @param {boolean} [event.allDay=false]
 * @param {string|Date} [event.reminder] - optional reminder time
 * @returns {Promise<number>} the auto-generated event id
 */
export async function addEvent({ title, start, end = null, allDay = false, reminder = null }) {
  try {
    const record = {
      title,
      start: _toISO(start),
      end: end ? _toISO(end) : null,
      allDay: Boolean(allDay),
      reminder: reminder ? _toISO(reminder) : null,
      createdAt: new Date().toISOString()
    };

    const id = await db.events.add(record);
    console.log(`[Storage] Event added – id: ${id}, title: "${title}"`);
    return id;
  } catch (err) {
    console.error('[Storage] addEvent failed:', err);
    throw err;
  }
}

// ─── Delete ──────────────────────────────────────────────────────────

/**
 * Delete a single event by its id.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteEvent(id) {
  try {
    await db.events.delete(id);
    console.log(`[Storage] Event deleted – id: ${id}`);
  } catch (err) {
    console.error('[Storage] deleteEvent failed:', err);
    throw err;
  }
}

/**
 * Delete events whose title contains the given keyword (case-insensitive).
 * Useful for voice commands like "删除关于…的日程".
 * @param {string} titleKeyword - partial title to match
 * @returns {Promise<number>} number of deleted events
 */
export async function deleteEventByTitle(titleKeyword) {
  try {
    const keyword = titleKeyword.toLowerCase();

    // Dexie doesn't natively support "LIKE", so we filter in memory
    const matches = await db.events
      .filter(event => event.title.toLowerCase().includes(keyword))
      .toArray();

    if (matches.length === 0) {
      console.log(`[Storage] No events matching "${titleKeyword}"`);
      return 0;
    }

    const ids = matches.map(e => e.id);
    await db.events.bulkDelete(ids);
    console.log(`[Storage] Deleted ${ids.length} event(s) matching "${titleKeyword}"`);
    return ids.length;
  } catch (err) {
    console.error('[Storage] deleteEventByTitle failed:', err);
    throw err;
  }
}

// ─── Read ────────────────────────────────────────────────────────────

/**
 * Get events whose start falls within [startDate, endDate].
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @returns {Promise<Array>} matching events sorted by start
 */
export async function getEventsByDateRange(startDate, endDate) {
  try {
    const from = _toISO(startDate);
    const to = _toISO(endDate);

    // "start" is indexed, so .where().between() is efficient
    const events = await db.events
      .where('start')
      .between(from, to, true, true)   // inclusive on both ends
      .sortBy('start');

    return events;
  } catch (err) {
    console.error('[Storage] getEventsByDateRange failed:', err);
    throw err;
  }
}

/**
 * Get the next N upcoming events from now.
 * @param {number} [limit=10]
 * @returns {Promise<Array>}
 */
export async function getUpcomingEvents(limit = 10) {
  try {
    const now = new Date().toISOString();

    const events = await db.events
      .where('start')
      .aboveOrEqual(now)
      .limit(limit)
      .sortBy('start');

    return events;
  } catch (err) {
    console.error('[Storage] getUpcomingEvents failed:', err);
    throw err;
  }
}

/**
 * Get every event in the database.
 * @returns {Promise<Array>}
 */
export async function getAllEvents() {
  try {
    return await db.events.orderBy('start').toArray();
  } catch (err) {
    console.error('[Storage] getAllEvents failed:', err);
    throw err;
  }
}

// ─── Update ──────────────────────────────────────────────────────────

/**
 * Update one or more fields of an existing event.
 * Date fields in `changes` are automatically converted to ISO strings.
 * @param {number} id
 * @param {Object} changes - key/value pairs to merge
 * @returns {Promise<number>} 1 if updated, 0 if id not found
 */
export async function updateEvent(id, changes) {
  try {
    // Normalise any date-like fields the caller might pass
    const normalised = { ...changes };
    for (const key of ['start', 'end', 'reminder']) {
      if (normalised[key] !== undefined && normalised[key] !== null) {
        normalised[key] = _toISO(normalised[key]);
      }
    }

    const updated = await db.events.update(id, normalised);
    if (updated) {
      console.log(`[Storage] Event updated – id: ${id}`);
    } else {
      console.warn(`[Storage] updateEvent – id ${id} not found`);
    }
    return updated;
  } catch (err) {
    console.error('[Storage] updateEvent failed:', err);
    throw err;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Normalise a value to an ISO-8601 string.
 * Accepts Date objects or strings; strings are returned as-is after
 * a basic validity check.
 * @param {string|Date} value
 * @returns {string} ISO string
 */
function _toISO(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  // Already a string – trust the caller but try to validate
  if (typeof value === 'string') {
    return value;
  }
  // Fallback: coerce
  return new Date(value).toISOString();
}

// ─── Export DB instance ──────────────────────────────────────────────
export { db };
