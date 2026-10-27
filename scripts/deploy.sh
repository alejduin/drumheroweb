#!/usr/bin/env bash
# Publica el frontend en Vercel (B12): solo sube el build estático, nunca el código
# ni worker/ (su .env tiene la clave secreta y poc/songs la música del usuario).
#   npm run deploy            → producción
#   npm run deploy -- preview → URL de vista previa
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]] || ! grep -q '^VITE_SUPABASE_URL=.\+' .env.local; then
  echo "Falta .env.local con VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY (ver .env.example)." >&2
  exit 1
fi

npm run build

# Build Output API v3: .vercel/output/static se sirve tal cual
rm -rf .vercel/output
mkdir -p .vercel/output
cp -r dist .vercel/output/static
cat > .vercel/output/config.json <<'JSON'
{
  "version": 3,
  "routes": [
    { "src": "/assets/(.*)", "headers": { "cache-control": "public, max-age=31536000, immutable" }, "continue": true },
    { "src": "/(sw\\.js|index\\.html)?", "headers": { "cache-control": "no-cache" }, "continue": true }
  ]
}
JSON

if [[ "${1:-}" == "preview" ]]; then
  npx -y vercel@65 deploy --prebuilt
else
  npx -y vercel@65 deploy --prebuilt --prod
fi
