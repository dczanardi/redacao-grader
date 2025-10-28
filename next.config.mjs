/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 1) Não deixe de preservar outras chaves que você já possa ter aqui.
    // 2) Garanta que este pacote NÃO seja tree-shakeado pelo Next:
    serverComponentsExternalPackages: ['@sparticuz/chromium'],

    // 3) (extra/seguro) Inclua também os diretórios do chromium no trace:
    outputFileTracingIncludes: {
      'app/api/report-pdf/route.ts': [
        './node_modules/@sparticuz/chromium/bin/**',
        './node_modules/@sparticuz/chromium/lib/**'
      ]
    }
  }
};

export default nextConfig;