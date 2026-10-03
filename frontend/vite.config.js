import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development Vite proxies REST + WebSocket traffic to the Node server,
// so the browser talks to a single origin exactly like in production.
const SERVER = process.env.VITE_DEV_SERVER_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/socket.io': { target: SERVER, ws: true },
    },
  },
});
