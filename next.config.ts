import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // VoidSpark runs as a local Next.js server (not a static export) — the API
  // routes drive tmux, the filesystem, and the GPU box, which static export
  // cannot do. Run with `npm run dev` (or `next start` after `next build`).
  // trailingSlash stays on: the app's own fetch calls hit `/api/.../` paths.
  trailingSlash: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
