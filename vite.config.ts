import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/start/vite';
import { VitePWA } from 'vite-plugin-pwa';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(({ ssrBuild }) => ({
  plugins: [
    tsconfigPaths(),
    tanstackStart(),
    // Use a short-circuit evaluation to only load the PWA plugin on client builds
    !ssrBuild && VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      manifest: {
        name: 'My App',
        short_name: 'App',
        theme_color: '#ffffff',
      },
      // Any other custom workbox/PWA settings you already have
    }),
  ].filter(Boolean), // Clean up false values from the array
}));
