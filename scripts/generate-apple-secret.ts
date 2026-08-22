// scripts/generate-apple-secret.ts
//
// Apple's OAuth "client secret" is not a static string like GitHub's —
// it's a JWT you sign yourself with the private key Apple gives you once,
// and it expires (Apple caps it at 6 months). This script generates that
// JWT so it can be pasted into AUTH_APPLE_SECRET in Vercel's env vars.
//
// One-time setup in the Apple Developer portal (developer.apple.com):
//   1. Certificates, Identifiers & Profiles → Identifiers → register an
//      App ID (if you don't have one) with "Sign in with Apple" enabled.
//   2. Identifiers → Services IDs → create one, e.g.
//      com.splntr-microtools.vml.web — this is AUTH_APPLE_ID. Configure
//      it with the production domain
//      (visual-mood-lab.splntr-microtools.com) and the redirect URL
//      Auth.js expects: https://visual-mood-lab.splntr-microtools.com/api/auth/callback/apple
//   3. Keys → create a new key with "Sign in with Apple" enabled, linked
//      to the App ID from step 1. Download the .p8 file ONCE — Apple will
//      not let you download it again. Note the Key ID shown on this page.
//   4. Your Team ID is in the top-right of the Apple Developer portal
//      (Membership page).
//
// Run:
//   AUTH_APPLE_TEAM_ID=... AUTH_APPLE_KEY_ID=... AUTH_APPLE_SERVICES_ID=... \
//   APPLE_PRIVATE_KEY_PATH=./AuthKey_XXXXXXXXXX.p8 \
//   node --env-file=.env.local scripts/generate-apple-secret.ts
//
// Copy the printed JWT into AUTH_APPLE_SECRET in Vercel. Set a calendar
// reminder before the expiry printed below — an expired secret fails
// Apple sign-in silently until someone notices and regenerates it.

import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

const TEAM_ID = process.env.AUTH_APPLE_TEAM_ID;
const KEY_ID = process.env.AUTH_APPLE_KEY_ID;
const SERVICES_ID = process.env.AUTH_APPLE_SERVICES_ID; // same value as AUTH_APPLE_ID
const KEY_PATH = process.env.APPLE_PRIVATE_KEY_PATH;

// Apple's hard cap is 6 months (15777000s). Default to 175 days to leave
// margin for rotating before it actually expires.
const TTL_SECONDS = 175 * 24 * 60 * 60;

async function main() {
  if (!TEAM_ID || !KEY_ID || !SERVICES_ID || !KEY_PATH) {
    console.error(
      'Missing one of AUTH_APPLE_TEAM_ID, AUTH_APPLE_KEY_ID, AUTH_APPLE_SERVICES_ID, APPLE_PRIVATE_KEY_PATH.',
    );
    process.exit(1);
  }

  const pkcs8 = readFileSync(KEY_PATH, 'utf8');
  const privateKey = await importPKCS8(pkcs8, 'ES256');

  const now = Math.floor(Date.now() / 1000);
  const exp = now + TTL_SECONDS;

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
    .setIssuer(TEAM_ID)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setAudience('https://appleid.apple.com')
    .setSubject(SERVICES_ID)
    .sign(privateKey);

  console.log('\nAUTH_APPLE_SECRET (paste into Vercel env vars):\n');
  console.log(jwt);
  console.log(`\nExpires: ${new Date(exp * 1000).toISOString()} — rotate before then.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
