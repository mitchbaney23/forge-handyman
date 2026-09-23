/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Reviewer avatars on the homepage come from Google (components/ReviewCard.tsx).
    remotePatterns: [{ protocol: 'https', hostname: '**.googleusercontent.com' }],
  },
  turbopack: {
    root: __dirname,
  },
}

module.exports = nextConfig
