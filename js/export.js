/**
 * export.js - 日历导出模块
 * 支持导出为标准 .ics (iCalendar RFC 5545) 格式
 * 可导入 Google Calendar、Apple Calendar、Outlook 等
 */

import { getAllEvents } from './storage.js';

/**
 * 将日期格式化为 ICS 格式: 20260529T090000
 */
function formatICSDate(dateStr) {
  const d = new Date(dateStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 生成唯一 UID
 */
function generateUID(id) {
  return `voical-${id}-${Date.now()}@voical.app`;
}

/**
 * 转义 ICS 文本中的特殊字符
 */
function escapeICS(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * 将单个事件转为 VEVENT 字符串
 */
function eventToVEvent(event) {
  const start = formatICSDate(event.start);
  const end = event.end ? formatICSDate(event.end) : formatICSDate(new Date(new Date(event.start).getTime() + 3600000).toISOString());
  const now = formatICSDate(new Date().toISOString());

  const lines = [
    'BEGIN:VEVENT',
    `UID:${generateUID(event.id)}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeICS(event.title)}`,
    `DESCRIPTION:Created by VoiCal`,
    'END:VEVENT'
  ];

  return lines.join('\r\n');
}

/**
 * 导出所有事件为 .ics 文件并触发下载
 */
export async function exportToICS() {
  const events = await getAllEvents();

  if (events.length === 0) {
    return { success: false, message: '没有事件可导出' };
  }

  const vevents = events.map(eventToVEvent).join('\r\n');

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VoiCal//Voice Calendar//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:VoiCal 语音日历',
    'X-WR-TIMEZONE:Asia/Shanghai',
    vevents,
    'END:VCALENDAR'
  ].join('\r\n');

  // 触发浏览器下载
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voical-${new Date().toISOString().split('T')[0]}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { success: true, message: `已导出 ${events.length} 个事件` };
}
