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
  // www and the old vercel.app address both served full copies of the site.
  // Send visitors and search engines to forgehandyman.com instead. /api/ is
  // left alone so webhooks and crons pointed at either host keep working.
  async redirects() {
    return ['www.forgehandyman.com', 'forge-handyman.vercel.app'].map((host) => ({
      source: '/:path((?!api/).*)',
      has: [{ type: 'host', value: host }],
      destination: 'https://forgehandyman.com/:path',
      permanent: true,
    }))
  },
}

module.exports = nextConfig
