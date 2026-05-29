/**
 * calendar.js - FullCalendar 封装模块
 * 管理日历的初始化、事件渲染和视图控制
 */

import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';

let calendarInstance = null;

/**
 * 初始化 FullCalendar
 * @param {HTMLElement} el - 日历挂载元素
 * @param {Object} options - 额外配置
 * @returns {Calendar} FullCalendar 实例
 */
export function initCalendar(el, options = {}) {
  calendarInstance = new Calendar(el, {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    locale: zhCnLocale,
    initialView: 'dayGridMonth',
    headerToolbar: false, // 我们用自定义 header
    height: 'auto',
    contentHeight: 'auto',
    editable: true,
    selectable: true,
    selectMirror: true,
    dayMaxEvents: true,  // 根据格子高度自动计算显示数量
    moreLinkClick: 'popover',
    nowIndicator: true,
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },

    // 事件点击
    eventClick: (info) => {
      if (options.onEventClick) {
        options.onEventClick(info.event);
      }
    },

    // 日期点击
    dateClick: (info) => {
      if (options.onDateClick) {
        options.onDateClick(info.date, info.dateStr);
      }
    },

    // 选择日期范围
    select: (info) => {
      if (options.onSelect) {
        options.onSelect(info.start, info.end);
      }
    },

    // 事件拖拽
    eventDrop: (info) => {
      if (options.onEventDrop) {
        options.onEventDrop(info.event);
      }
    },

    // 事件调整大小
    eventResize: (info) => {
      if (options.onEventResize) {
        options.onEventResize(info.event);
      }
    },

    ...options
  });

  calendarInstance.render();
  return calendarInstance;
}

/**
 * 获取日历实例
 */
export function getCalendar() {
  return calendarInstance;
}

/**
 * 添加事件到日历
 * @param {Object} event - { id, title, start, end, allDay, color }
 */
export function addCalendarEvent(event) {
  if (!calendarInstance) return;

  const isCompleted = !!event.completed;

  calendarInstance.addEvent({
    id: String(event.id),
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay || false,
    backgroundColor: isCompleted ? '#999' : (event.color || '#e8684a'),
    borderColor: isCompleted ? '#999' : (event.color || '#e8684a'),
    classNames: isCompleted ? ['event-completed'] : [],
    extendedProps: {
      reminder: event.reminder || 0,
      dbId: event.id,
      completed: isCompleted
    }
  });
}

/**
 * 从日历删除事件
 * @param {string|number} eventId
 */
export function removeCalendarEvent(eventId) {
  if (!calendarInstance) return;

  const event = calendarInstance.getEventById(String(eventId));
  if (event) {
    event.remove();
  }
}

/**
 * 批量加载事件到日历
 * @param {Array} events - 事件列表
 */
export function loadEvents(events) {
  if (!calendarInstance) return;

  // 先清空
  calendarInstance.removeAllEvents();

  // 批量添加
  events.forEach(event => {
    addCalendarEvent(event);
  });
}

/**
 * 切换日历视图
 * @param {string} viewName - 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'
 */
export function changeView(viewName) {
  if (!calendarInstance) return;
  calendarInstance.changeView(viewName);
}

/**
 * 跳转到今天
 */
export function goToToday() {
  if (!calendarInstance) return;
  calendarInstance.today();
}

/**
 * 前一页
 */
export function goPrev() {
  if (!calendarInstance) return;
  calendarInstance.prev();
}

/**
 * 后一页
 */
export function goNext() {
  if (!calendarInstance) return;
  calendarInstance.next();
}

/**
 * 获取当前日历标题（如 "2026年5月"）
 */
export function getTitle() {
  if (!calendarInstance) return '';
  return calendarInstance.view.title;
}

/**
 * 获取所有日历事件
 */
export function getAllCalendarEvents() {
  if (!calendarInstance) return [];
  return calendarInstance.getEvents();
}
