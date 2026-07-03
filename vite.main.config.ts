import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  // Load .env* files (no prefix filter, so plain names like GITHUB_CLIENT_ID
  // are included) and bake the ones the main process needs into the bundle.
  // The GitHub device-flow client id is public, so embedding it is fine — and
  // this makes it available in `npm start` and in packaged builds alike. A real
  // launch-time env var still wins, because main.ts checks process.env first.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      __GITHUB_CLIENT_ID__: JSON.stringify(env.GITHUB_CLIENT_ID ?? ''),
      __GITLAB_CLIENT_ID__: JSON.stringify(env.GITLAB_CLIENT_ID ?? ''),
    },
  };
});
