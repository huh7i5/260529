/**
 * speech.js — Web Speech API module for VoiCal
 *
 * Provides voice recognition (SpeechRecognition) and
 * text-to-speech (SpeechSynthesis) with Chinese (zh-CN) support.
 */

// ─── Error message map (human-readable Chinese) ─────────────────
const ERROR_MESSAGES = {
  'not-allowed':  '麦克风权限被拒绝，请在浏览器设置中允许使用麦克风。',
  'no-speech':    '没有检测到语音，请再试一次。',
  'network':      '网络错误，请检查网络连接后重试。',
  'aborted':      '语音识别已取消。',
  'audio-capture':'找不到麦克风设备，请检查麦克风连接。',
  'service-not-allowed': '语音识别服务不可用，请稍后再试。',
};

function friendlyError(errorCode) {
  return ERROR_MESSAGES[errorCode] || `语音识别出错：${errorCode}`;
}

// ─── SpeechManager ──────────────────────────────────────────────
export class SpeechManager {
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
      utterance.lang  = 'zh-CN';
      utterance.rate  = 1.0;
      utterance.pitch = 1.0;

      if (this.#zhVoice) {
        utterance.voice = this.#zhVoice;
      }

      utterance.addEventListener('start', () => this.#setState('speaking'));

      utterance.addEventListener('end', () => {
        this.#setState('idle');
        resolve();
      });

      utterance.addEventListener('error', (e) => {
        this.#setState('idle');
        // 'canceled' is not really an error from the user's POV
        if (e.error === 'canceled' || e.error === 'interrupted') {
          resolve();
        } else {
          reject(new Error(`语音合成出错：${e.error}`));
        }
      });

      this.#synthesis.speak(utterance);
    });
  }

  /**
   * Register a callback that receives interim (partial) recognition text.
   * @param {(text: string) => void} callback
   */
  onInterimResult(callback) {
    this.#interimCallback = callback;
  }

  /**
   * Register a callback that fires on state changes.
   * @param {(state: 'idle' | 'listening' | 'processing' | 'speaking') => void} callback
   */
  onStateChange(callback) {
    this.#stateCallback = callback;
  }

  /** Get the current state. */
  get state() {
    return this.#state;
  }

  // ── Private helpers ────────────────────────────────────────────

  /** Pick the best zh-CN voice from available voices. */
  #pickVoice() {
    if (!this.#synthesis) return;

    const voices = this.#synthesis.getVoices();
    // Prefer a voice whose lang starts with 'zh-CN'
    this.#zhVoice =
      voices.find((v) => v.lang === 'zh-CN') ||
      voices.find((v) => v.lang.startsWith('zh-CN')) ||
      voices.find((v) => v.lang.startsWith('zh')) ||
      null;
  }

  /**
   * Handle recognition results.
   * @param {SpeechRecognitionEvent} event
   */
  #handleResult(event) {
    let interimTranscript = '';
    let finalTranscript   = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text   = result[0].transcript;

      if (result.isFinal) {
        finalTranscript += text;
      } else {
        interimTranscript += text;
      }
    }

    // Stream interim text to the callback
    if (interimTranscript && this.#interimCallback) {
      this.#interimCallback(interimTranscript);
    }

    // If we have a final result, resolve the promise
    if (finalTranscript) {
      this.#setState('processing');
      if (this.#interimCallback) {
        this.#interimCallback(finalTranscript);
      }
      if (this.#resolveListening) {
        this.#resolveListening(finalTranscript);
        this.#resolveListening = null;
        this.#rejectListening  = null;
      }
    }
  }

  /**
   * Handle recognition errors.
   * @param {SpeechRecognitionErrorEvent} event
   */
  #handleError(event) {
    const code    = event.error;
    const message = friendlyError(code);

    this.#setState('idle');

    if (this.#rejectListening) {
      const err  = new Error(message);
      err.code   = code;
      this.#rejectListening(err);
      this.#resolveListening = null;
      this.#rejectListening  = null;
    }
  }

  /** Called when recognition ends (may or may not have produced a result). */
  #handleEnd() {
    // If the promise was never resolved (e.g. user stayed silent),
    // transition back to idle cleanly.
    if (this.#state === 'listening') {
      this.#setState('idle');
    }

    // If still pending (no final result and no error), reject gracefully.
    if (this.#rejectListening) {
      this.#rejectListening(new Error(friendlyError('no-speech')));
      this.#resolveListening = null;
      this.#rejectListening  = null;
    }
  }

  /**
   * Transition to a new state and notify the callback.
   * @param {'idle' | 'listening' | 'processing' | 'speaking'} newState
   */
  #setState(newState) {
    if (newState === this.#state) return;
    this.#state = newState;
    if (this.#stateCallback) {
      try {
        this.#stateCallback(newState);
      } catch {
        // Don't let a bad callback crash the manager
      }
    }
  }
}

// ─── Singleton default export ───────────────────────────────────
const speechManager = new SpeechManager();
export default speechManager;
