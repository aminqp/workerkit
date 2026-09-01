import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  publicDir: false,
  plugins: [
    dts({
      include: ['src/tools', 'src/workers'],
      outDir: 'dist/types',
      tsconfigPath: './tsconfig.json',
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/tools/index.ts'),
        'define-worker': resolve(__dirname, 'src/tools/define-worker/index.ts'),
      },
      name: 'WebWorkerManager',
      fileName: (format, entryName) =>
        `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs'],
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // no external deps — library is self-contained
    },
  },
});
