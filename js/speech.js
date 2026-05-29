/**
 * speech.js — Sherpa-ONNX WebAssembly ASR module for VoiCal
 *
 * Provides highly accurate offline voice recognition using k2-fsa/sherpa-onnx
 * and retains text-to-speech (SpeechSynthesis).
 */

const ERROR_MESSAGES = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许使用麦克风。',
  'no-speech': '没有检测到语音，请再试一次。',
  'network': '网络错误，请检查网络连接后重试。',
  'not-ready': '语音引擎正在加载中，请稍后再试（首次加载需要下载约 15MB 模型）。',
};

function friendlyError(errorCode) {
  return ERROR_MESSAGES[errorCode] || `语音识别出错：${errorCode}`;
}

export class SpeechManager {
  #state = 'idle';
  #supported = false;
  #interimCallback = null;
  #stateCallback = null;

  #resolveListening = null;
  #rejectListening = null;

  // WASM / AudioContext state
  #recognizer = null;
  #recognizerStream = null;
  #audioCtx = null;
  #mediaStream = null;
  #recorder = null;
  #recordSampleRate = 16000;
  #expectedSampleRate = 16000;
  #lastResult = '';
  
  // TTS state
  #synthesis = null;
  #zhVoice = null;

  constructor() {
    // Check Web Audio API support
    if (!window.AudioContext && !window.webkitAudioContext) {
      this.#supported = false;
      return;
    }
    
    this.#supported = true;

    // --- Synthesis setup ---
    this.#synthesis = window.speechSynthesis ?? null;
    if (this.#synthesis) {
      this.#pickVoice();
      if (this.#synthesis.onvoiceschanged !== undefined) {
        this.#synthesis.addEventListener('voiceschanged', () => this.#pickVoice());
      }
    }
  }

  isSupported() {
    return this.#supported;
  }

  async startListening() {
    return new Promise(async (resolve, reject) => {
      if (!this.#supported) {
        return reject(new Error('当前浏览器不支持录音 API。'));
      }
      
      if (!window.__SherpaWasmReady || !window.Module) {
        return reject(new Error(friendlyError('not-ready')));
      }

      // 确保单次运行
      if (this.#state === 'listening') {
        this.stopListening();
      }

      this.#resolveListening = resolve;
      this.#rejectListening = reject;
      this.#lastResult = '';

      try {
        this.#setState('listening');
        
        // 1. 初始化引擎（单例）
        if (!this.#recognizer) {
          // createOnlineRecognizer is globally exposed by sherpa-onnx-asr.js
          this.#recognizer = createOnlineRecognizer(window.Module);
        }

        // 2. 请求麦克风
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        if (!this.#audioCtx) {
          this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.#expectedSampleRate });
        }
        
        // 恢复 AudioContext（应对浏览器限制）
        if (this.#audioCtx.state === 'suspended') {
          await this.#audioCtx.resume();
        }

        this.#recordSampleRate = this.#audioCtx.sampleRate;
        this.#mediaStream = this.#audioCtx.createMediaStreamSource(stream);

        // 3. 配置录音节点
        const bufferSize = 4096;
        if (this.#audioCtx.createScriptProcessor) {
          this.#recorder = this.#audioCtx.createScriptProcessor(bufferSize, 1, 1);
        } else {
          this.#recorder = this.#audioCtx.createJavaScriptNode(bufferSize, 1, 1);
        }

        this.#recognizerStream = this.#recognizer.createStream();

        // 4. 处理音频流
        this.#recorder.onaudioprocess = (e) => {
          let samples = new Float32Array(e.inputBuffer.getChannelData(0));
          samples = this.#downsampleBuffer(samples, this.#expectedSampleRate);

          if (this.#recognizerStream) {
            this.#recognizerStream.acceptWaveform(this.#expectedSampleRate, samples);
            
            while (this.#recognizer.isReady(this.#recognizerStream)) {
              this.#recognizer.decode(this.#recognizerStream);
            }

            const isEndpoint = this.#recognizer.isEndpoint(this.#recognizerStream);
            const result = this.#recognizer.getResult(this.#recognizerStream).text;

            if (result.length > 0 && this.#lastResult !== result) {
              this.#lastResult = result;
              if (this.#interimCallback) this.#interimCallback(result);
            }

            // 如果说话停顿结束 (Endpointing)
            if (isEndpoint) {
               const finalText = this.#lastResult;
               this.stopListening(); // 停止录音
               
               if (finalText.trim().length > 0) {
                 this.#setState('processing');
                 if (this.#resolveListening) {
                   this.#resolveListening(finalText);
                   this.#clearPromises();
                 }
               } else {
                 this.#handleEndNoResult();
               }
            }
          }
        };

        // 连接链路启动录音
        this.#mediaStream.connect(this.#recorder);
        this.#recorder.connect(this.#audioCtx.destination);

      } catch (err) {
        this.stopListening();
        this.#setState('idle');
        
        if (err.name === 'NotAllowedError') {
          reject(new Error(friendlyError('not-allowed')));
        } else {
          reject(new Error(`麦克风错误: ${err.message}`));
        }
        this.#clearPromises();
      }
    });
  }

  stopListening() {
    if (this.#recorder && this.#audioCtx) {
      this.#recorder.disconnect();
      if (this.#mediaStream) {
        this.#mediaStream.disconnect();
        // 停止麦克风硬件流
        this.#mediaStream.mediaStream.getTracks().forEach(track => track.stop());
      }
    }
    
    if (this.#recognizer && this.#recognizerStream) {
      // 获取最后的可能残余文本
      let finalRes = this.#recognizer.getResult(this.#recognizerStream).text;
      if (finalRes && finalRes !== this.#lastResult) {
         this.#lastResult = finalRes;
      }
      this.#recognizer.reset(this.#recognizerStream);
      this.#recognizerStream.free();
      this.#recognizerStream = null;
    }

    if (this.#state === 'listening') {
      this.#setState('idle');
    }
  }

  speak(text) {
    return new Promise((resolve, reject) => {
      if (!this.#synthesis) return resolve();

      this.#synthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      if (this.#zhVoice) utterance.voice = this.#zhVoice;

      utterance.addEventListener('start', () => this.#setState('speaking'));
      utterance.addEventListener('end', () => {
        this.#setState('idle');
        resolve();
      });
      utterance.addEventListener('error', (e) => {
        this.#setState('idle');
        if (e.error === 'canceled' || e.error === 'interrupted') {
          resolve();
        } else {
          reject(new Error(`语音合成出错：${e.error}`));
        }
      });

      this.#synthesis.speak(utterance);
    });
  }

  onInterimResult(callback) { this.#interimCallback = callback; }
  onStateChange(callback) { this.#stateCallback = callback; }
  get state() { return this.#state; }

  // ── Private helpers ────────────────────────────────────────────

  #clearPromises() {
    this.#resolveListening = null;
    this.#rejectListening = null;
  }

  #handleEndNoResult() {
    if (this.#rejectListening) {
      this.#rejectListening(new Error(friendlyError('no-speech')));
      this.#clearPromises();
    }
    this.#setState('idle');
  }

  #pickVoice() {
    if (!this.#synthesis) return;
    const voices = this.#synthesis.getVoices();
    this.#zhVoice = voices.find(v => v.lang === 'zh-CN') ||
                    voices.find(v => v.lang.startsWith('zh')) || null;
  }

  #setState(newState) {
    if (newState === this.#state) return;
    this.#state = newState;
    if (this.#stateCallback) {
      try { this.#stateCallback(newState); } catch {}
    }
  }

  #downsampleBuffer(buffer, exportSampleRate) {
    if (exportSampleRate === this.#recordSampleRate) return buffer;
    const sampleRateRatio = this.#recordSampleRate / exportSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      let nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }
}

const speechManager = new SpeechManager();
export default speechManager;
