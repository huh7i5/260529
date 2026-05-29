/**
 * visualizer.js - 语音波形可视化模块
 * 使用 Web Audio API (AudioContext + AnalyserNode) 捕获麦克风音频流
 * 在 Canvas 上绘制环形频谱动画，围绕麦克风按钮
 */

let analyser = null;
let sourceRef = null;   // Reference to the shared source node (don't own it)
let animationId = null;
let canvas = null;
let ctx = null;

const BAR_COUNT = 48;
const MIN_BAR_HEIGHT = 2;
const MAX_BAR_HEIGHT = 36;

/**
 * 初始化可视化器（支持 resize 自动重算 HiDPI）
 * @param {string} canvasId - Canvas 元素 ID
 */
export function initVisualizer(canvasId = 'mic-visualizer') {
  canvas = document.getElementById(canvasId);
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  resizeCanvas();

  // Re-init on resize so HiDPI stays correct
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
  ctx.scale(dpr, dpr);
}

/**
 * 开始捕获麦克风并绘制波形
 */
export async function startVisualization() {
  if (!canvas || !ctx) return;

  try {
    // 独立获取麦克风流
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;

    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);

    draw();
  } catch (err) {
    console.warn('无法获取麦克风用于可视化:', err.message);
  }
}

/**
 * 停止可视化并释放资源
 * 只断开 analyser — 不关闭 audioContext / 不停 mediaStream（它们属于 speech.js）
 */
export function stopVisualization() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (analyser) {
    try { analyser.disconnect(); } catch (_) {}
    analyser = null;
  }

  sourceRef = null;

  // 清空 canvas
  if (canvas && ctx) {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }
}

/**
 * 绘制环形频谱
 * innerRadius 动态计算：取麦克风按钮实际尺寸的一半 + 小间距
 */
function draw() {
  if (!analyser || !ctx || !canvas) return;

  animationId = requestAnimationFrame(draw);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const centerX = w / 2;
  const centerY = h / 2;

  // Dynamically compute innerRadius from the actual mic button size
  const micBtn = document.getElementById('btn-mic');
  let innerRadius;
  if (micBtn) {
    const btnRect = micBtn.getBoundingClientRect();
    innerRadius = btnRect.width / 2 + 4; // button radius + 4px gap
  } else {
    innerRadius = 38; // fallback
  }

  // Cap max bar height so it doesn't overflow the canvas
  const maxBarH = Math.min(MAX_BAR_HEIGHT, (Math.min(w, h) / 2) - innerRadius - 2);

  // 获取当前主题色
  const style = getComputedStyle(document.documentElement);
  const primaryColor = style.getPropertyValue('--color-primary').trim() || '#e8684a';

  for (let i = 0; i < BAR_COUNT; i++) {
    const dataIndex = Math.floor(i * bufferLength / BAR_COUNT);
    const value = dataArray[dataIndex] / 255;

    const barHeight = MIN_BAR_HEIGHT + value * maxBarH;
    const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;

    const x1 = centerX + Math.cos(angle) * innerRadius;
    const y1 = centerY + Math.sin(angle) * innerRadius;
    const x2 = centerX + Math.cos(angle) * (innerRadius + barHeight);
    const y2 = centerY + Math.sin(angle) * (innerRadius + barHeight);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.4 + value * 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
