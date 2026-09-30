/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@automation/core",
    "@automation/providers",
    "@automation/provider-instagram-official",
    "@automation/reliability",
    "@automation/storage-postgres"
  ]
};

export default nextConfig;
