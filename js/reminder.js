/**
 * reminder.js - 事件提醒模块
 * 使用 Notification API 实现浏览器推送通知
 */

let reminderInterval = null;
let notifiedEvents = new Set(); // 已提醒的事件ID，避免重复提醒

/**
 * 初始化提醒系统
 * 请求通知权限并启动轮询
 */
export async function initReminder() {
  // 请求通知权限
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }

  // 启动轮询（每30秒检查一次）
  startReminderPolling();
}

/**
 * 启动提醒轮询
 * @param {Function} getEvents - 获取事件列表的函数
 */
let getEventsCallback = null;

export function setGetEventsCallback(callback) {
  getEventsCallback = callback;
}

function startReminderPolling() {
  // 清除旧的轮询
  if (reminderInterval) {
    clearInterval(reminderInterval);
  }

  // 每 30 秒检查一次
  reminderInterval = setInterval(checkReminders, 30000);

  // 立即检查一次
  checkReminders();
}

/**
 * 检查是否有需要提醒的事件
 */
async function checkReminders() {
  if (!getEventsCallback) return;

  try {
    const events = await getEventsCallback();
    const now = new Date();

    events.forEach(event => {
      if (notifiedEvents.has(event.id)) return;

      const startTime = new Date(event.start);
      const reminderMinutes = event.reminder || 0;

      if (reminderMinutes <= 0) return;

      // 计算提醒时间
      const reminderTime = new Date(startTime.getTime() - reminderMinutes * 60 * 1000);
      const timeDiff = reminderTime.getTime() - now.getTime();

      // 如果在提醒窗口内（过去5分钟到未来30秒之间）
      if (timeDiff <= 30000 && timeDiff >= -300000) {
        sendNotification(event, reminderMinutes);
        notifiedEvents.add(event.id);
      }
    });
  } catch (error) {
    console.error('检查提醒失败:', error);
  }
}

/**
 * 发送浏览器通知
 * @param {Object} event - 事件对象
 * @param {number} minutesBefore - 提前分钟数
 */
function sendNotification(event, minutesBefore) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const startTime = new Date(event.start);
  const timeStr = `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`;

  const notification = new Notification(`📅 ${event.title}`, {
    body: `将在 ${minutesBefore} 分钟后开始 (${timeStr})`,
    icon: '/assets/icon-192.png',
    tag: `event-${event.id}`,
    requireInteraction: true
  });

  // 点击通知聚焦窗口
  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  // 30秒后自动关闭
  setTimeout(() => notification.close(), 30000);
}

/**
 * 用语音播报提醒（与 speech.js 配合使用）
 * @param {Object} event - 事件对象
 * @param {Function} speakFn - 语音播报函数
 */
export function speakReminder(event, speakFn) {
  if (!speakFn) return;

  const startTime = new Date(event.start);
  const hours = startTime.getHours();
  const minutes = startTime.getMinutes();

  let timeDesc = '';
  if (hours < 12) {
    timeDesc = `上午${hours}点`;
  } else if (hours === 12) {
    timeDesc = '中午12点';
  } else {
    timeDesc = `下午${hours - 12}点`;
  }
  if (minutes > 0) {
    timeDesc += `${minutes}分`;
  }

  speakFn(`提醒您，${event.title}将在${timeDesc}开始`);
}

/**
 * 清除已提醒记录（当事件被删除时调用）
 * @param {number} eventId
 */
export function clearNotified(eventId) {
  notifiedEvents.delete(eventId);
}

/**
 * 停止提醒轮询
 */
export function stopReminder() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}
