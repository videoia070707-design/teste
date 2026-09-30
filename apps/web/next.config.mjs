/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@automation/core",
    "@automation/providers",
    "@automation/reliability"
  ]
};

export default nextConfig;
