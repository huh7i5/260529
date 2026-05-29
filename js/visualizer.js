/**
 * visualizer.js - 语音波形可视化模块
 * 使用 Web Audio API (AudioContext + AnalyserNode) 捕获麦克风音频流
 * 在 Canvas 上绘制环形频谱动画，围绕麦克风按钮
 */

let audioContext = null;
let analyser = null;
let mediaStream = null;
let animationId = null;
let canvas = null;
let ctx = null;

const BAR_COUNT = 48;
const MIN_BAR_HEIGHT = 2;
const MAX_BAR_HEIGHT = 36;

/**
 * 初始化可视化器
 * @param {string} canvasId - Canvas 元素 ID
 */
export function initVisualizer(canvasId = 'mic-visualizer') {
  canvas = document.getElementById(canvasId);
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  // HiDPI 支持
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
}

/**
 * 开始绘制波形
 * @param {MediaStreamAudioSourceNode} sourceStream - 从 SpeechManager 传入的现有音频源
 */
export async function startVisualization(sourceStream) {
  if (!canvas || !ctx || !sourceStream) return;

  try {
    // 共享现有的音频流，避免二次请求麦克风引发硬件冲突
    mediaStream = sourceStream.mediaStream;
    audioContext = sourceStream.context;

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;

    // 连接到分析器，不影响原有的录音链路
    sourceStream.connect(analyser);

    draw();
  } catch (err) {
    console.warn('无法获取麦克风用于可视化:', err.message);
  }
}

/**
 * 停止可视化并释放资源
 */
export function stopVisualization() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  analyser = null;

  // 清空 canvas
  if (canvas && ctx) {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }
}

/**
 * 绘制环形频谱
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
  const innerRadius = 38; // 麦克风按钮外侧

  // 获取当前主题色
  const style = getComputedStyle(document.documentElement);
  const primaryColor = style.getPropertyValue('--color-primary').trim() || '#e8684a';

  for (let i = 0; i < BAR_COUNT; i++) {
    // 从频谱数据中采样
    const dataIndex = Math.floor(i * bufferLength / BAR_COUNT);
    const value = dataArray[dataIndex] / 255;

    const barHeight = MIN_BAR_HEIGHT + value * MAX_BAR_HEIGHT;
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
