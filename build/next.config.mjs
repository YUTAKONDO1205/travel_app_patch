/** @type {import('next').NextConfig} */
const distDir = process.env.NEXT_DIST_DIR?.trim();

const nextConfig = {
  ...(distDir ? { distDir } : {}),
  experimental: {
    cpus: 1,
    workerThreads: true,
    webpackBuildWorker: false,
  },
};

export default nextConfig;
