import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 빌드 산출물 index.html 을 jq-playground.html 로 바꾼다
const renameOutput = () => ({
  name: 'rename-output',
  apply: 'build' as const,
  enforce: 'post' as const,
  generateBundle: {
    order: 'post' as const,
    handler(_: unknown, bundle: Record<string, { fileName: string }>) {
      const html = bundle['index.html']
      if (html) html.fileName = 'jq-playground.html'
    },
  },
})

export default defineConfig({
  plugins: [svelte(), viteSingleFile({ removeViteModuleLoader: true }), renameOutput()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  // file:// 에서 열리므로 상대 경로여야 한다
  base: './',
})
