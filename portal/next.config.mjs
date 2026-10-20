/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Region pinned to Mumbai in deploy config, colocated with the spine (sibling-app pattern).
  experimental: {
    // Photos on an answer (migration 249): up to four, shrunk in the browser to
    // about 400 KB each. Vercel itself refuses a request over 4.5 MB.
    serverActions: { bodySizeLimit: '4mb' },
  },
};
export default nextConfig;
