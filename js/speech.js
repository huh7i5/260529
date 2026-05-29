function friendlyError(type) {
  const msgs = {
    'not-allowed': '未获得麦克风权限，请在浏览器地址栏左侧点击锁图标允许麦克风访问。',
    'no-speech': '没有检测到语音输入，请重试',
    'network': '网络连接失败，请检查网络设置',
    'default': '语音识别发生未知错误，请重试'
  };
  return msgs[type] || msgs['default'];
}

class SpeechManager {
  /** @type {'idle' | 'listening' | 'processing' | 'speaking'} */
  #state = 'idle';

  /** @type {SpeechRecognition | null} */
  #recognition = null;

  /** @type {SpeechSynthesis | null} */
  #synthesis = null;

  /** @type {SpeechSynthesisVoice | null} */
  #zhVoice = null;

  /** @type {boolean} */
  #supported = false;

  /** @type {Function | null} */
  #interimCallback = null;

  /** @type {Function | null} */
  #stateCallback = null;

  /** Resolve / reject for the current startListening() promise */
  #resolveListening = null;
  #rejectListening  = null;

  // ── Constructor ────────────────────────────────────────────────
  constructor() {
    // Feature-detect SpeechRecognition
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.#supported = false;
      return;
    }

    this.#supported = true;

    // --- Recognition setup ---
    const recognition = new SpeechRecognition();
    recognition.lang           = 'zh-CN';
    recognition.continuous     = false;   // one-shot per click
    recognition.interimResults = true;    // stream partial text
    recognition.maxAlternatives = 1;

    recognition.addEventListener('result',    (e) => this.#handleResult(e));
    recognition.addEventListener('error',     (e) => this.#handleError(e));
    recognition.addEventListener('end',       ()  => this.#handleEnd());
    recognition.addEventListener('audiostart',()  => this.#setState('listening'));

    this.#recognition = recognition;

    // --- Synthesis setup ---
    this.#synthesis = window.speechSynthesis ?? null;
    if (this.#synthesis) {
      this.#pickVoice();
      // Voices may load asynchronously (Chrome)
      if (this.#synthesis.onvoiceschanged !== undefined) {
        this.#synthesis.addEventListener('voiceschanged', () => this.#pickVoice());
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Whether the browser supports both recognition & synthesis. */
  isSupported() {
    return this.#supported;
  }

  /**
   * Start listening for speech.
   * @returns {Promise<string>} Resolves with the final transcript text.
   */
  startListening() {
    return new Promise((resolve, reject) => {
      if (!this.#supported || !this.#recognition) {
        reject(new Error('当前浏览器不支持语音识别，请使用 Chrome 或 Edge。'));
        return;
      }

      // If already listening, stop first
      if (this.#state === 'listening') {
        this.stopListening();
      }

      this.#resolveListening = resolve;
      this.#rejectListening  = reject;

      try {
        this.#setState('listening');
        this.#recognition.start();
      } catch (err) {
        // e.g. "already started"
        this.#setState('idle');
        reject(new Error(friendlyError(err.message)));
      }
    });
  }

  /** Programmatically stop the current recognition session. */
  stopListening() {
    if (this.#recognition) {
      try {
        this.#recognition.stop();
      } catch {
        // ignore if not started
      }
    }
  }

  /**
   * Speak text in Chinese.
   * @param {string} text
   * @returns {Promise<void>} Resolves when speaking finishes.
   */
  speak(text) {
    return new Promise((resolve, reject) => {
      if (!this.#synthesis) {
        resolve(); // fail silently – synthesis is a nice-to-have
        return;
      }

      // Cancel any ongoing speech
      this.#synthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
    });
  }
}

const speechManager = new SpeechManager();
export default speechManager;
