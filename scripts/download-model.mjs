import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicJsDir = path.join(rootDir, 'public', 'js');

const MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2/sherpa-onnx-wasm-simd-v1.13.2-zh-en-asr-zipformer.tar.bz2';
const TAR_NAME = 'sherpa-onnx-wasm-simd-v1.13.2-zh-en-asr-zipformer.tar.bz2';
const FOLDER_NAME = 'sherpa-onnx-wasm-simd-v1.13.2-zh-en-asr-zipformer';

async function main() {
  if (!fs.existsSync(publicJsDir)) {
    fs.mkdirSync(publicJsDir, { recursive: true });
  }

  // Check if model already downloaded
  if (fs.existsSync(path.join(publicJsDir, 'sherpa-onnx-wasm-main-asr.data'))) {
    console.log('Sherpa-ONNX model already exists in public/js/. Skipping download.');
    return;
  }

  console.log(`Downloading Sherpa-ONNX model from ${MODEL_URL}...`);
  try {
    // We use curl and tar which are available on Windows 10/11
    execSync(`curl.exe -L -o ${TAR_NAME} ${MODEL_URL}`, { cwd: publicJsDir, stdio: 'inherit' });
    console.log('Extracting archive...');
    execSync(`tar xf ${TAR_NAME}`, { cwd: publicJsDir, stdio: 'inherit' });
    
    console.log('Moving files to public/js...');
    const sourceDir = path.join(publicJsDir, FOLDER_NAME);
    const files = fs.readdirSync(sourceDir);
    for (const file of files) {
      fs.renameSync(path.join(sourceDir, file), path.join(publicJsDir, file));
    }
    
    console.log('Cleaning up...');
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(path.join(publicJsDir, TAR_NAME), { force: true });
    
    console.log('Model download and setup complete!');
  } catch (error) {
    console.error('Failed to download or extract model:', error.message);
    process.exit(1);
  }
}

main();
