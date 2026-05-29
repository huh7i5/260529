function friendlyError(type) {
  const msgs = {
    'not-allowed': '未获得麦克风权限，请在浏览器地址栏左侧点击锁图标允许麦克风访问。',
    'no-speech': '没有检测到语音输入，请重试',
    'network': '网络连接失败，请检查后端服务器 (server.js) 是否已启动',
    'default': '语音识别发生未知错误，请重试'
  };
  return msgs[type] || msgs['default'];
}

let audioCtx;
let mediaStream;
let recorder;
let ws;

class SpeechManager {
  constructor() {
    this.state = 'idle';
    this.interimCallback = null;
    this.stateCallback = null;
    this.isListening = false;
    this.resolvePromise = null;
    this.finalText = '';
  }

  isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
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

  async startListening() {
    if (this.isListening) return;

    return new Promise(async (resolve, reject) => {
      try {
        this.resolvePromise = resolve;
        this.finalText = '';
        this.isListening = true;
        this.setState('listening');

        ws = new WebSocket('ws://localhost:3002');
        
        ws.onopen = async () => {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          
          if (!audioCtx) {
            audioCtx = new AudioContext({ sampleRate: 16000 });
          }
          
          mediaStream = audioCtx.createMediaStreamSource(stream);
          
          const bufferSize = 4096;
          if (audioCtx.createScriptProcessor) {
            recorder = audioCtx.createScriptProcessor(bufferSize, 1, 1);
          } else {
            recorder = audioCtx.createJavaScriptNode(bufferSize, 1, 1);
          }
          
          recorder.onaudioprocess = (e) => {
            if (!this.isListening || ws.readyState !== WebSocket.OPEN) return;
            const inputData = e.inputBuffer.getChannelData(0);
            ws.send(inputData.buffer); // Float32Array buffer
          };

          mediaStream.connect(recorder);
          recorder.connect(audioCtx.destination);
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'interim') {
            if (this.interimCallback) this.interimCallback(data.text);
          } else if (data.type === 'final') {
            this.finalText += data.text;
            if (this.interimCallback) this.interimCallback(this.finalText);
          }
        };

        ws.onerror = () => {
          this.cleanup();
          reject(new Error(friendlyError('network')));
        };

        ws.onclose = () => {
          this.cleanup();
        };

      } catch (error) {
        this.cleanup();
        reject(error);
      }
    });
  }

  stopListening() {
    if (!this.isListening) return;
    this.setState('processing');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('stop');
      
      setTimeout(() => {
        this.cleanup();
        if (this.resolvePromise) {
          if (!this.finalText) {
            // reject
          } else {
            this.resolvePromise(this.finalText);
          }
          this.resolvePromise = null;
        }
      }, 500);
    } else {
      this.cleanup();
      if (this.resolvePromise) {
        this.resolvePromise(this.finalText);
        this.resolvePromise = null;
      }
    }
  }

  cleanup() {
    this.isListening = false;
    this.setState('idle');

    if (recorder) {
      recorder.disconnect();
      recorder = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream.disconnect();
      mediaStream = null;
    }
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      ws = null;
    }
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
