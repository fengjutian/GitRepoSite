// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// RepoSite's own UI. The generated target sites are produced by the
// deterministic generator in src/lib/site, not by this Astro build.
export default defineConfig({
  site: 'https://reposite.netlify.app',
  output: 'static',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
