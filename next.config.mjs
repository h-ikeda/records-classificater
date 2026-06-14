/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Prisma client must run on the Node.js runtime, not the Edge runtime.
  serverExternalPackages: ['@prisma/client', 'prisma'],
};

export default nextConfig;
