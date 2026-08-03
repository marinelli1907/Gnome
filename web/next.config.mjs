import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Public discovery site is read-only; keep builds resilient.
  eslint: { ignoreDuringBuilds: true },
  // Pin tracing to this app (a stray lockfile in $HOME otherwise confuses Next).
  outputFileTracingRoot: __dirname,
  // Self-contained server bundle for the VPS deploy (see web/deploy/).
  output: 'standalone',
};

export default nextConfig;
