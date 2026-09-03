/** @type {import("next").NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/",
        destination: "/kyb",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
