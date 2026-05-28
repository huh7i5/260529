/**
 * main.js - VoiCal 应用主入口
 * 初始化所有模块并串联语音 → NLP → 存储 → 日历的完整流程
 * 
 * 本项目借助 Antigravity (Google DeepMind) 开发
 */

import { initCalendar, addCalendarEvent, removeCalendarEvent, loadEvents, changeView, goToToday, goPrev, goNext, getTitle } from './calendar.js';
import { initDB, addEvent, deleteEvent, deleteEventByTitle, getUpcomingEvents, getAllEvents, getEventsByDateRange, checkConflicts, addRecurringEvents } from './storage.js';
import { parseVoiceCommand } from './nlp.js';
import speechManager from './speech.js';
import { initReminder, setGetEventsCallback } from './reminder.js';
import { exportToICS } from './export.js';
import { initVisualizer, startVisualization, stopVisualization } from './visualizer.js';
import {
  showToast,
  openAddEventModal,
  closeModal,
  renderUpcomingEvents,
  setMicState,
  showTranscript,
  hideTranscript,
  showVoiceFeedback,
  hideVoiceFeedback,
  checkCompatibility
} from './ui.js';

// ============ 应用初始化 ============

async function init() {
  console.log('🗓️ VoiCal 初始化中...');

  // 1. 初始化数据库
  await initDB();
  console.log('✅ 存储就绪');

  // 2. 初始化可视化器
  initVisualizer();

  // 3. 初始化日历
  const calendarEl = document.getElementById('calendar');
  initCalendar(calendarEl, {
    onDateClick: (date) => {
      openAddEventModal(date);
    },
    onEventClick: (event) => {
      handleEventClick(event);
    },
    onEventDrop: (event) => {
      handleEventDrag(event);
    }
  });
  console.log('✅ 日历就绪');

  // 初始化日历标题
  updateCalendarTitle();

  // 3. 加载已有事件
  await refreshCalendarEvents();
  await refreshUpcomingEvents();

  // 4. 初始化提醒系统
  setGetEventsCallback(getAllEvents);
  await initReminder();
  console.log('✅ 提醒系统就绪');

  // 5. 检查浏览器兼容性
  checkCompatibility();

  // 6. 绑定事件监听
  bindEventListeners();

  // 7. 设置语音状态回调
  setupSpeechCallbacks();

  console.log('🚀 VoiCal 就绪！');

  // 8. 今日简报（延迟2秒，等页面加载完）
  setTimeout(() => morningBriefing(), 2000);
}

// ============ 事件监听绑定 ============

function bindEventListeners() {
  // 麦克风按钮
  const btnMic = document.getElementById('btn-mic');
  btnMic?.addEventListener('click', handleMicClick);

  // 视图切换按钮
  document.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.dataset.view;
      changeView(view);
      // 更新 active 状态
      document.querySelectorAll('.btn-view').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      updateCalendarTitle();
    });
  });

  // 今天按钮
  document.getElementById('btn-today')?.addEventListener('click', () => {
    goToToday();
    updateCalendarTitle();
  });

  // 前/后翻页按钮
  document.getElementById('btn-prev')?.addEventListener('click', () => {
    goPrev();
    updateCalendarTitle();
  });
  document.getElementById('btn-next')?.addEventListener('click', () => {
    goNext();
    updateCalendarTitle();
  });

  // 主题切换
  initTheme();
  document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);

  // 手动添加按钮
  document.getElementById('btn-add-manual')?.addEventListener('click', () => {
    openAddEventModal();
  });

  // 导出按钮
  document.getElementById('btn-export')?.addEventListener('click', async () => {
    const result = await exportToICS();
    showToast(result.message, result.success ? 'success' : 'warning');
  });

  // Modal 关闭
  document.getElementById('btn-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // 表单提交
  document.getElementById('form-add-event')?.addEventListener('submit', handleFormSubmit);

  // 兼容性警告关闭
  document.getElementById('btn-dismiss-warning')?.addEventListener('click', () => {
    document.getElementById('compat-warning')?.classList.add('hidden');
  });

  // 事件列表删除按钮（事件委托）
  document.getElementById('events-list')?.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.event-delete');
    if (deleteBtn) {
      const eventId = parseInt(deleteBtn.dataset.eventId);
      handleDeleteEvent(eventId);
    }
  });

  // 示例 chips 点击
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const text = chip.textContent.replace(/["""]/g, '');
      processVoiceCommand(text);
    });
  });

  // 全局键盘快捷键
  document.addEventListener('keydown', (e) => {
    // 输入框中不触发快捷键
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') closeModal();
      return;
    }

    switch (e.key) {
      case 'Escape':
        closeModal();
        break;
      case ' ':  // 空格 = 麦克风开关
        e.preventDefault();
        handleMicClick();
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        openAddEventModal();
        break;
      case 'm':
        changeView('dayGridMonth');
        document.querySelectorAll('.btn-view').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="dayGridMonth"]')?.classList.add('active');
        updateCalendarTitle();
        break;
      case 'w':
        changeView('timeGridWeek');
        document.querySelectorAll('.btn-view').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="timeGridWeek"]')?.classList.add('active');
        updateCalendarTitle();
        break;
      case 'd':
        changeView('timeGridDay');
        document.querySelectorAll('.btn-view').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="timeGridDay"]')?.classList.add('active');
        updateCalendarTitle();
        break;
      case 't':
        goToToday();
        updateCalendarTitle();
        break;
      case 'k':
        toggleTheme();
        break;
      case 'ArrowLeft':
        if (!e.ctrlKey && !e.metaKey) {
          goPrev();
          updateCalendarTitle();
        }
        break;
      case 'ArrowRight':
        if (!e.ctrlKey && !e.metaKey) {
          goNext();
          updateCalendarTitle();
        }
        break;
    }
  });
}

// ============ 语音交互 ============

function setupSpeechCallbacks() {
  if (!speechManager.isSupported()) return;

  speechManager.onStateChange((state) => {
    setMicState(state === 'speaking' ? 'idle' : state);
  });

  speechManager.onInterimResult((text) => {
    showTranscript(text, false);
  });
}

let isListening = false;

async function handleMicClick() {
  if (!speechManager.isSupported()) {
    showToast('当前浏览器不支持语音识别，请使用 Chrome 或 Edge', 'error');
    return;
  }

  if (isListening) {
    speechManager.stopListening();
    isListening = false;
    setMicState('idle');
    hideTranscript();
    stopVisualization();
    return;
  }

  try {
    isListening = true;
    setMicState('listening');
    hideVoiceFeedback();
    startVisualization();

    const transcript = await speechManager.startListening();
    isListening = false;
    stopVisualization();

    if (transcript) {
      showTranscript(transcript, true);
      setMicState('processing');
      await processVoiceCommand(transcript);
    }

    setMicState('idle');
  } catch (error) {
    isListening = false;
    setMicState('idle');
    hideTranscript();
    stopVisualization();

    if (error.message !== '没有检测到语音输入，请重试') {
      showVoiceFeedback(error.message || '语音识别失败', true);
    } else {
      showVoiceFeedback('没有检测到语音，请再试一次', true);
    }
  }
}

// ============ 语音指令处理 ============

async function processVoiceCommand(text) {
  console.log('📝 处理指令:', text);

  const command = parseVoiceCommand(text);
  console.log('🔍 解析结果:', command);

  // 如果有智能纠错，先提示
  if (command.correction) {
    showToast(`智能纠正：${command.correction}`, 'warning', 4000);
  }

  switch (command.intent) {
    case 'ADD':
      await handleAddByVoice(command);
      break;
    case 'RECURRING':
      await handleRecurringByVoice(command);
      break;
    case 'DELETE':
      await handleDeleteByVoice(command);
      break;
    case 'QUERY':
      await handleQueryByVoice(command);
      break;
    case 'MODIFY':
      showVoiceFeedback('修改功能开发中，请手动修改', true);
      await speechManager.speak('修改功能暂不支持，请手动操作');
      break;
    default:
      showVoiceFeedback('抱歉，没有理解你的指令，请重新说', true);
      await speechManager.speak('抱歉，我没有理解你的指令');
      break;
  }

  // 延迟隐藏 transcript
  setTimeout(() => hideTranscript(), 2000);
}

// ============ 语音 → 添加事件 ============

async function handleAddByVoice(command) {
  if (!command.startDate) {
    showVoiceFeedback('无法识别时间，请再说一次', true);
    await speechManager.speak('我没有识别到时间，请再说一次');
    return;
  }

  const title = command.title || '未命名事件';
  const start = command.startDate;
  const end = command.endDate || new Date(start.getTime() + 60 * 60 * 1000);

  try {
    // 冲突检测
    const conflicts = await checkConflicts(start, end);
    if (conflicts.length > 0) {
      const conflictNames = conflicts.map(c => c.title).join('、');
      showToast(`⚠️ 时间冲突：与「${conflictNames}」重叠`, 'warning', 5000);
      await speechManager.speak(`注意，这个时间段与${conflictNames}有冲突，已为您添加`);
    }

    const id = await addEvent({
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      reminder: 15
    });

    // 添加到日历 UI
    addCalendarEvent({ id, title, start: start.toISOString(), end: end.toISOString() });

    // 刷新即将到来的事件
    await refreshUpcomingEvents();

    // 反馈
    const timeStr = formatTimeSpeak(start);
    const feedback = `已添加：${timeStr} ${title}`;
    showVoiceFeedback(feedback);
    showToast(feedback, 'success');
    await speechManager.speak(feedback);

  } catch (error) {
    console.error('添加事件失败:', error);
    showVoiceFeedback('添加事件失败，请重试', true);
  }
}

// ============ 语音 → 删除事件 ============

async function handleDeleteByVoice(command) {
  const keyword = command.title;
  if (!keyword) {
    showVoiceFeedback('请说出要删除的事件名称', true);
    await speechManager.speak('请告诉我要删除哪个事件');
    return;
  }

  try {
    const count = await deleteEventByTitle(keyword);

    if (count > 0) {
      // 刷新日历和事件列表
      await refreshCalendarEvents();
      await refreshUpcomingEvents();

      const feedback = `已删除 ${count} 个与"${keyword}"相关的事件`;
      showVoiceFeedback(feedback);
      showToast(feedback, 'success');
      await speechManager.speak(`已删除${count}个事件`);
    } else {
      showVoiceFeedback(`没有找到与"${keyword}"相关的事件`, true);
      await speechManager.speak(`没有找到${keyword}相关的事件`);
    }
  } catch (error) {
    console.error('删除事件失败:', error);
    showVoiceFeedback('删除失败，请重试', true);
  }
}

// ============ 语音 → 查询事件 ============

async function handleQueryByVoice(command) {
  try {
    let events;
    let periodDesc = '';

    if (command.startDate && command.endDate) {
      events = await getEventsByDateRange(command.startDate, command.endDate);
      periodDesc = command.title || '该时间段';
    } else if (command.startDate) {
      // 查询某一天
      const dayStart = new Date(command.startDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(command.startDate);
      dayEnd.setHours(23, 59, 59, 999);
      events = await getEventsByDateRange(dayStart, dayEnd);
      periodDesc = getDateLabel(command.startDate);
    } else {
      // 默认查询今天
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      events = await getEventsByDateRange(today, todayEnd);
      periodDesc = '今天';
    }

    if (events.length === 0) {
      const feedback = `${periodDesc}没有安排`;
      showVoiceFeedback(feedback);
      await speechManager.speak(feedback);
    } else {
      const summary = events.map(e => {
        const t = new Date(e.start);
        return `${t.getHours()}点${t.getMinutes() > 0 ? t.getMinutes() + '分' : ''} ${e.title}`;
      }).join('，');

      const feedback = `${periodDesc}有 ${events.length} 个安排：${events.map(e => e.title).join('、')}`;
      showVoiceFeedback(feedback);
      await speechManager.speak(`${periodDesc}有${events.length}个安排：${summary}`);
    }
  } catch (error) {
    console.error('查询事件失败:', error);
    showVoiceFeedback('查询失败，请重试', true);
  }
}

// ============ 手动操作 ============

async function handleFormSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('input-title').value.trim();
  const date = document.getElementById('input-date').value;
  const time = document.getElementById('input-time').value;
  const duration = parseInt(document.getElementById('input-duration').value) || 60;
  const reminder = parseInt(document.getElementById('input-reminder').value) || 0;

  if (!title || !date || !time) {
    showToast('请填写完整信息', 'warning');
    return;
  }

  const start = new Date(`${date}T${time}`);
  const end = new Date(start.getTime() + duration * 60 * 1000);

  try {
    const id = await addEvent({
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      reminder
    });

    addCalendarEvent({ id, title, start: start.toISOString(), end: end.toISOString() });
    await refreshUpcomingEvents();

    showToast(`已添加：${title}`, 'success');
    closeModal();
  } catch (error) {
    console.error('手动添加失败:', error);
    showToast('添加失败，请重试', 'error');
  }
}

async function handleDeleteEvent(eventId) {
  try {
    await deleteEvent(eventId);
    removeCalendarEvent(eventId);
    await refreshUpcomingEvents();
    showToast('事件已删除', 'success');
  } catch (error) {
    console.error('删除失败:', error);
    showToast('删除失败', 'error');
  }
}

function handleEventClick(fcEvent) {
  const eventId = parseInt(fcEvent.extendedProps?.dbId || fcEvent.id);
  if (confirm(`要删除「${fcEvent.title}」吗？`)) {
    handleDeleteEvent(eventId);
  }
}

async function handleEventDrag(fcEvent) {
  const eventId = parseInt(fcEvent.extendedProps?.dbId || fcEvent.id);
  try {
    const { updateEvent } = await import('./storage.js');
    await updateEvent(eventId, {
      start: fcEvent.start.toISOString(),
      end: fcEvent.end ? fcEvent.end.toISOString() : new Date(fcEvent.start.getTime() + 3600000).toISOString()
    });
    showToast('事件已移动', 'success');
  } catch (error) {
    console.error('拖拽更新失败:', error);
  }
}

// ============ 数据刷新 ============

async function refreshCalendarEvents() {
  const events = await getAllEvents();
  loadEvents(events);
}

async function refreshUpcomingEvents() {
  const events = await getUpcomingEvents(10);
  renderUpcomingEvents(events);
}

// ============ 日历标题更新 ============

function updateCalendarTitle() {
  const titleEl = document.getElementById('calendar-title');
  if (titleEl) {
    titleEl.textContent = getTitle();
  }
}

// ============ 主题切换 ============

function initTheme() {
  const saved = localStorage.getItem('voical-theme');
  const btn = document.getElementById('btn-theme-toggle');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
  } else {
    // 跟随系统偏好
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (btn) btn.textContent = prefersDark ? '☀️' : '🌙';
  }
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const btn = document.getElementById('btn-theme-toggle');

  if (current === 'dark') {
    html.setAttribute('data-theme', 'light');
    localStorage.setItem('voical-theme', 'light');
    if (btn) btn.textContent = '🌙';
  } else {
    html.setAttribute('data-theme', 'dark');
    localStorage.setItem('voical-theme', 'dark');
    if (btn) btn.textContent = '☀️';
  }
}

// ============ 工具函数 ============

function formatTimeSpeak(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((targetDay - today) / (86400000));

  let dayStr = '';
  if (diffDays === 0) dayStr = '今天';
  else if (diffDays === 1) dayStr = '明天';
  else if (diffDays === 2) dayStr = '后天';
  else if (diffDays === -1) dayStr = '昨天';
  else dayStr = `${date.getMonth() + 1}月${date.getDate()}日`;

  const hours = date.getHours();
  const minutes = date.getMinutes();
  let period = '';
  if (hours < 12) period = '上午';
  else if (hours === 12) period = '中午';
  else period = '下午';

  const displayHour = hours > 12 ? hours - 12 : hours;
  const timeStr = minutes > 0 ? `${displayHour}点${minutes}分` : `${displayHour}点`;

  return `${dayStr}${period}${timeStr}`;
}

function getDateLabel(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((target - today) / 86400000);

  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// ============ 语音 → 重复事件 ============

async function handleRecurringByVoice(command) {
  if (!command.startDate) {
    showVoiceFeedback('无法识别时间，请再说一次', true);
    await speechManager.speak('我没有识别到时间，请再说一次');
    return;
  }

  const title = command.title || '重复事件';
  const start = command.startDate;
  const end = command.endDate || new Date(start.getTime() + 60 * 60 * 1000);
  const recurrence = command.recurrence;

  if (!recurrence) {
    // 降级为普通添加
    await handleAddByVoice(command);
    return;
  }

  try {
    const count = await addRecurringEvents({
      title,
      startDate: start,
      endDate: end,
      recurrence,
      weeks: 8,
      reminder: 15
    });

    await refreshCalendarEvents();
    await refreshUpcomingEvents();

    const typeDesc = {
      'daily': '每天',
      'weekly': `每周${['日','一','二','三','四','五','六'][recurrence.dayOfWeek || 0]}`,
      'monthly': `每月${recurrence.dayOfMonth}日`,
      'weekdays': '每个工作日'
    }[recurrence.type] || '定期';

    const feedback = `已创建重复事件：${typeDesc} ${title}，共 ${count} 个`;
    showVoiceFeedback(feedback);
    showToast(feedback, 'success');
    await speechManager.speak(`已创建${typeDesc}的${title}，接下来8周共${count}个`);

  } catch (error) {
    console.error('创建重复事件失败:', error);
    showVoiceFeedback('创建重复事件失败', true);
  }
}

// ============ 今日简报 ============

async function morningBriefing() {
  if (!speechManager.isSupported()) return;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const events = await getEventsByDateRange(today, todayEnd);

    if (events.length === 0) {
      showVoiceFeedback('今天暂无日程安排，祝您有美好的一天！');
      await speechManager.speak('今天没有日程安排，祝您有美好的一天');
    } else {
      const summary = events.map(e => {
        const t = new Date(e.start);
        const h = t.getHours();
        const m = t.getMinutes();
        const period = h < 12 ? '上午' : h === 12 ? '中午' : '下午';
        const dh = h > 12 ? h - 12 : h;
        return `${period}${dh}点${m > 0 ? m + '分' : ''} ${e.title}`;
      }).join('，');

      const greeting = `今天有${events.length}个安排：${summary}`;
      showVoiceFeedback(greeting);
      await speechManager.speak(greeting);
    }
  } catch (error) {
    console.error('今日简报失败:', error);
  }
}

// ============ 启动 ============

document.addEventListener('DOMContentLoaded', init);
