import { defineConfig } from 'vite';

export default defineConfig({
  // WebAssembly 엔진 기반인 h5wasm 라이브러리가 Vite 최적화 프로세스와 엉키지 않게 설정
  optimizeDeps: {
    exclude: ['h5wasm']
  }
});
