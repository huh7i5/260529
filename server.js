import { WebSocketServer } from 'ws';
import sherpa_onnx from 'sherpa-onnx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3002;

console.log('Initializing Sherpa-ONNX model...');

const modelDir = path.join(__dirname, 'models', 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20');

const featConfig = {
  sampleRate: 16000,
  featureDim: 80,
};

const modelConfig = {
  transducer: {
    encoder: path.join(modelDir, 'encoder-epoch-99-avg-1.int8.onnx'),
    decoder: path.join(modelDir, 'decoder-epoch-99-avg-1.onnx'),
    joiner: path.join(modelDir, 'joiner-epoch-99-avg-1.int8.onnx'),
  },
  tokens: path.join(modelDir, 'tokens.txt'),
  provider: 'cpu',
  numThreads: 2,
  modelType: 'zipformer',
  debug: 0,
};

let recognizer;
try {
  recognizer = sherpa_onnx.createOnlineRecognizer({
    featConfig: featConfig,
    modelConfig: modelConfig,
  });
  console.log('Sherpa-ONNX engine initialized successfully!');
} catch (error) {
  console.error('Failed to initialize Sherpa-ONNX:', error);
  process.exit(1);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  console.log('Client connected for ASR');
  
  // Each client connection gets its own stream
  let stream = recognizer.createStream();
  let lastText = '';

  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      // Receive Float32Array PCM chunks
      const float32Array = new Float32Array(
        message.buffer, 
        message.byteOffset, 
        message.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      
      stream.acceptWaveform(16000, float32Array);
      
      while (recognizer.isReady(stream)) {
        recognizer.decode(stream);
      }
      
      const isEndpoint = recognizer.isEndpoint(stream);
      const text = recognizer.getResult(stream).text;
      
      if (text && text !== lastText) {
        lastText = text;
        ws.send(JSON.stringify({ type: 'interim', text }));
      }
      
      if (isEndpoint) {
        if (text) {
          ws.send(JSON.stringify({ type: 'final', text }));
        }
        recognizer.reset(stream);
        lastText = '';
      }
    } else {
      // Handle string messages like 'stop' or 'reset'
      const data = message.toString();
      if (data === 'stop') {
        const text = recognizer.getResult(stream).text;
        if (text) {
          ws.send(JSON.stringify({ type: 'final', text }));
        }
        recognizer.reset(stream);
        lastText = '';
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (stream) {
      stream.free(); // important to free C++ memory
      stream = null;
    }
  });
});

console.log(`ASR WebSocket server running on ws://localhost:${PORT}`);
