/** @type {import('next').NextConfig} */
const nextConfig = {
  // ...o que já existe aí...
  experimental: {
    // mantenha outras chaves que você já tenha aqui
    outputFileTracingIncludes: {
      "app/api/report-pdf/route.ts": [
        "./node_modules/@sparticuz/chromium/bin/**"
      ]
    }
  }
};

export default nextConfig;