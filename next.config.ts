import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a verification build write to its own directory (NEXT_DIST_DIR=.next-verify) so it never
  // clobbers the running dev server's .next — the dev server no longer has to be stopped to build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'midfield.mlbstatic.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'img.mlbstatic.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'a.espncdn.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
