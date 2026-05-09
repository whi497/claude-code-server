import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const devPort = Number(process.env.VITE_DEV_PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const apiHost = process.env.API_HOST ?? 'localhost';
const apiTarget = `http://${apiHost}:${apiPort}`;
const wsTarget = `ws://${apiHost}:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: {
    port: devPort,
    proxy: {
      '/api': apiTarget,
      '/ws': { target: wsTarget, ws: true },
      '/terminal': { target: wsTarget, ws: true },
    },
  },
});
