function friendlyError(type) {
  const msgs = {
    'not-allowed': '未获得麦克风权限，请在浏览器地址栏左侧点击锁图标允许麦克风访问。',
    'no-speech': '没有检测到语音输入，请重试',
    'network': '网络连接失败，请检查后端服务器 (server.js) 是否已启动',
    'default': '语音识别发生未知错误，请重试'
  };
  return msgs[type] || msgs['default'];
}

function downsampleBuffer(buffer, recordSampleRate, exportSampleRate) {
  if (exportSampleRate === recordSampleRate) {
    // Web Audio API 的 getChannelData 返回的可能是一个极大内存池的视图 (View)。
    // 必须克隆出一个干净的 Float32Array，否则直接发 `.buffer` 会把大量内存垃圾发给模型，导致严重幻听和死循环！
    return new Float32Array(buffer);
  }
  const sampleRateRatio = recordSampleRate / exportSampleRate;
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

let audioCtx;
let sourceNode;      // MediaStreamAudioSourceNode (for connect/disconnect)
let rawStream;       // Raw MediaStream from getUserMedia (for stopping tracks)
let recorder;
let ws;

class SpeechManager {
  constructor() {
    this.state = 'idle';
    this.interimCallback = null;
    this.stateCallback = null;
    this.isListening = false;
    this.resolvePromise = null;
    this.rejectPromise = null;
    this.finalText = '';
    this._autoStopTimer = null;  // debounce timer for auto-stop after final
  }

  isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  getStream() {
    return sourceNode;
  }

  setState(newState) {
    this.state = newState;
    if (this.stateCallback) this.stateCallback(newState);
  }

  onInterimResult(callback) {
    this.interimCallback = callback;
  }

  onStateChange(callback) {
    this.stateCallback = callback;
  }

  /**
   * Reset the auto-stop debounce timer.
   * After 1.5s of silence (no new interim/final), automatically stop listening.
   */
  _resetAutoStopTimer() {
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
    }
    this._autoStopTimer = setTimeout(() => {
      if (this.isListening && this.finalText.trim().length > 0) {
        this.stopListening();
      }
    }, 1500);
  }

  async startListening() {
    if (this.isListening) return;

    return new Promise(async (resolve, reject) => {
      try {
        this.resolvePromise = resolve;
        this.rejectPromise = reject;
        this.finalText = '';
        this.isListening = true;

        ws = new WebSocket('ws://localhost:3002');
        
        ws.onopen = async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            rawStream = stream;  // Bug 1 fix: store the raw MediaStream separately
            
            if (!audioCtx || audioCtx.state === 'closed') {
              audioCtx = new AudioContext({ sampleRate: 16000 });
            }
            // Resume if suspended (browsers may suspend AudioContext until user gesture)
            if (audioCtx.state === 'suspended') {
              await audioCtx.resume();
            }
            
            sourceNode = audioCtx.createMediaStreamSource(stream);
            this.setState('listening');
            
            const bufferSize = 4096;
            if (audioCtx.createScriptProcessor) {
              recorder = audioCtx.createScriptProcessor(bufferSize, 1, 1);
            } else {
              recorder = audioCtx.createJavaScriptNode(bufferSize, 1, 1);
            }
            
            recorder.onaudioprocess = (e) => {
              if (!this.isListening || !ws || ws.readyState !== WebSocket.OPEN) return;
              const inputData = e.inputBuffer.getChannelData(0);
              
              // 强制降采样，确保传入后端的都是纯净的 16000Hz 音频
              const downsampled = downsampleBuffer(inputData, audioCtx.sampleRate, 16000);
              
              // 直接发送降采样后的独立 Float32Array 缓冲区
              ws.send(downsampled.buffer);
            };

            sourceNode.connect(recorder);
            recorder.connect(audioCtx.destination);
          } catch (micError) {
            this.cleanup();
            reject(new Error(friendlyError('not-allowed')));
          }
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'interim') {
            // Bug 2 fix: reset debounce timer on every interim result
            if (this._autoStopTimer) {
              clearTimeout(this._autoStopTimer);
              this._autoStopTimer = null;
            }
            if (this.interimCallback) this.interimCallback(this.finalText + data.text);
          } else if (data.type === 'final') {
            this.finalText += data.text;
            if (this.interimCallback) this.interimCallback(this.finalText);
            
            // Bug 2 fix: don't stop immediately — use debounce.
            // Wait 1.5s after the last final before auto-stopping.
            if (this.finalText.trim().length > 0) {
              this._resetAutoStopTimer();
            }
          }
        };

        ws.onerror = () => {
          this.cleanup();
          reject(new Error(friendlyError('network')));
        };

        ws.onclose = () => {
          // Only cleanup if we're still listening (avoid double cleanup)
          if (this.isListening) {
            this.cleanup();
          }
        };

      } catch (error) {
        this.cleanup();
        reject(error);
      }
    });
  }

  stopListening() {
    if (!this.isListening) return;
    
    // Clear debounce timer
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }
    
    this.setState('processing');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('stop');
      
      // Give server a moment to send back any remaining text
      setTimeout(() => {
        this.cleanup();
        if (this.resolvePromise) {
          // Bug 3 fix: always resolve (with empty string if no text), never leave hanging
          this.resolvePromise(this.finalText || '');
          this.resolvePromise = null;
          this.rejectPromise = null;
        }
      }, 500);
    } else {
      this.cleanup();
      if (this.resolvePromise) {
        // Bug 3 fix: always resolve
        this.resolvePromise(this.finalText || '');
        this.resolvePromise = null;
        this.rejectPromise = null;
      }
    }
  }

  cleanup() {
    this.isListening = false;
    this.setState('idle');

    // Clear debounce timer
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }

    if (recorder) {
      recorder.disconnect();
      recorder = null;
    }
    
    // Bug 1 fix: sourceNode is an AudioNode — only disconnect it
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    
    // Bug 1 fix: rawStream is the actual MediaStream — stop its tracks
    if (rawStream) {
      rawStream.getTracks().forEach(t => t.stop());
      rawStream = null;
    }
    
    if (ws) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      ws = null;
    }
    
    // Don't close audioCtx — it can be reused across sessions.
    // Closing it would break the visualizer and require re-creation.
  }

  async speak(text) {
    if (!('speechSynthesis' in window)) return;
    return new Promise((resolve) => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }
}

const speechManager = new SpeechManager();
export default speechManager;
