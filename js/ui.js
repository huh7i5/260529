/**
 * ui.js - UI 交互模块
 * Toast 通知、Modal 控制、事件列表渲染、麦克风状态管理
 */

// ============ Toast 通知系统 ============

/**
 * 显示 Toast 通知
 * @param {string} message - 消息内容
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - 持续时间（毫秒）
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${getToastIcon(type)}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  // 自动消失
  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, duration);
}

function getToastIcon(type) {
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  return icons[type] || icons.info;
}

// ============ Modal 控制 ============

/**
 * 打开手动添加事件 Modal
 */
export function openAddEventModal(defaultDate = null) {
  const overlay = document.getElementById('modal-overlay');
  const dateInput = document.getElementById('input-date');
  const timeInput = document.getElementById('input-time');
  const titleInput = document.getElementById('input-title');

  if (!overlay) return;

  // 设置默认日期
  if (defaultDate) {
    dateInput.value = formatDateForInput(defaultDate);
    timeInput.value = formatTimeForInput(defaultDate);
  } else {
    const now = new Date();
    dateInput.value = formatDateForInput(now);
    timeInput.value = '09:00';
  }

  titleInput.value = '';
  overlay.classList.remove('hidden');
  titleInput.focus();
}

/**
 * 关闭 Modal
 */
export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

// ============ 事件列表渲染 ============

/**
 * 渲染即将到来的事件列表
 * @param {Array} events - 事件列表
 */
export function renderUpcomingEvents(events) {
  const listEl = document.getElementById('events-list');
  if (!listEl) return;

  if (!events || events.length === 0) {
    listEl.innerHTML = '<p class="empty-state">暂无日程安排</p>';
    return;
  }

  listEl.innerHTML = events.map(event => {
    const startDate = new Date(event.start);
    const timeStr = formatEventTime(startDate);
    const dateStr = formatEventDate(startDate);
    const done = !!event.completed;

    return `
      <div class="event-item${done ? ' done' : ''}" data-event-id="${event.id}" data-action="toggle">
        <div class="event-color-dot${done ? ' completed' : ''}"></div>
        <div class="event-info">
          <div class="event-title${done ? ' completed' : ''}">${escapeHtml(event.title)}</div>
          <div class="event-time">${dateStr} ${timeStr}</div>
        </div>
        <button class="event-delete-btn" data-event-id="${event.id}" data-action="delete" title="删除">×</button>
      </div>
    `;
  }).join('');
}

// ============ 麦克风 UI 状态 ============

/**
 * 设置麦克风按钮状态
 * @param {'idle' | 'listening' | 'processing' | 'loading'} state
 */
export function setMicState(state) {
  const btn = document.getElementById('btn-mic');
  const container = btn?.closest('.mic-container');
  const micIcon = document.getElementById('mic-icon');
  const stopIcon = document.getElementById('mic-stop-icon');
  const loadingIcon = document.getElementById('mic-loading-icon');
  const hint = document.getElementById('voice-hint');

  if (!btn) return;

  // 清除所有状态
  btn.classList.remove('listening', 'processing', 'loading');
  container?.classList.remove('listening');

  switch (state) {
    case 'loading':
      btn.classList.add('loading');
      micIcon?.classList.add('hidden');
      stopIcon?.classList.add('hidden');
      loadingIcon?.classList.remove('hidden');
      loadingIcon?.classList.add('spin');
      if (hint) hint.textContent = '首次加载，正在下载模型引擎...';
      break;

    case 'listening':
      btn.classList.add('listening');
      container?.classList.add('listening');
      micIcon?.classList.add('hidden');
      stopIcon?.classList.remove('hidden');
      loadingIcon?.classList.add('hidden');
      if (hint) hint.textContent = '正在聆听...请说出你的指令';
      break;

    case 'processing':
      btn.classList.add('processing');
      micIcon?.classList.remove('hidden');
      stopIcon?.classList.add('hidden');
      loadingIcon?.classList.add('hidden');
      if (hint) hint.textContent = '正在处理...';
      break;

    case 'idle':
    default:
      micIcon?.classList.remove('hidden');
      stopIcon?.classList.add('hidden');
      loadingIcon?.classList.add('hidden');
      if (hint) hint.textContent = '点击麦克风，说出你的指令';
      break;
  }
}

/**
 * 显示语音识别实时文本
 * @param {string} text - 识别文本
 * @param {boolean} isFinal - 是否为最终结果
 */
export function showTranscript(text, isFinal = false) {
  const textEl = document.getElementById('status-feedback-text');
  const iconEl = document.querySelector('#status-feedback .status-icon');

  if (!textEl) return;

  textEl.textContent = isFinal ? `🎯 "${text}"` : `🎙️ ${text}...`;
  if (iconEl) iconEl.textContent = isFinal ? '🎯' : '🎙️';

  // 高亮状态栏
  const feedbackEl = document.getElementById('status-feedback');
  feedbackEl?.classList.add('highlight');
}

/**
 * 隐藏语音识别文本
 */
export function hideTranscript() {
  const textEl = document.getElementById('status-feedback-text');
  const iconEl = document.querySelector('#status-feedback .status-icon');
  const feedbackEl = document.getElementById('status-feedback');

  if (textEl) textEl.textContent = '就绪 — 点击麦克风或按空格键开始语音';
  if (iconEl) iconEl.textContent = '💬';
  feedbackEl?.classList.remove('highlight');
}

/**
 * 显示语音操作反馈
 * @param {string} message - 反馈消息
 * @param {boolean} isError - 是否为错误
 */
export function showVoiceFeedback(message, isError = false) {
  const feedbackEl = document.getElementById('status-feedback');
  const textEl = document.getElementById('status-feedback-text');
  const iconEl = feedbackEl?.querySelector('.status-icon');

  if (!textEl) return;

  textEl.textContent = message;
  if (iconEl) iconEl.textContent = isError ? '❌' : '✅';

  // 高亮动画
  feedbackEl?.classList.add('highlight');
  setTimeout(() => {
    feedbackEl?.classList.remove('highlight');
  }, 3000);
}

/**
 * 隐藏语音反馈
 */
export function hideVoiceFeedback() {
  const textEl = document.getElementById('status-feedback-text');
  const iconEl = document.querySelector('#status-feedback .status-icon');
  if (textEl) textEl.textContent = '就绪 — 点击麦克风或按空格键开始语音';
  if (iconEl) iconEl.textContent = '💬';
}

/**
 * 更新状态栏统计数字
 */
export function updateStatusStats(todayCount, weekCount) {
  const todayEl = document.getElementById('status-today-count');
  const weekEl = document.getElementById('status-week-count');
  if (todayEl) todayEl.textContent = todayCount;
  if (weekEl) weekEl.textContent = weekCount;
}

// ============ 浏览器兼容性检测 ============

/**
 * 检查并显示兼容性警告
 */
export function checkCompatibility() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    const warning = document.getElementById('compat-warning');
    if (warning) {
      warning.classList.remove('hidden');
    }
  }
}

// ============ 工具函数 ============

function formatDateForInput(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeForInput(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatEventTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatEventDate(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((eventDay - today) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '明天';
  if (diffDays === 2) return '后天';
  if (diffDays === -1) return '昨天';

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
