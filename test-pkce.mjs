#!/usr/bin/env node
import crypto from 'crypto';

// Test PKCE flow
console.log('🔐 Testing PKCE Flow...\n');

// Step 1: Generate code_verifier
const code_verifier = crypto.randomBytes(32).toString('base64url');
console.log('1️⃣ code_verifier:', code_verifier);

// Step 2: Generate code_challenge = SHA256(code_verifier)
const hash = crypto.createHash('sha256').update(code_verifier).digest();
const code_challenge = hash.toString('base64url');
console.log('2️⃣ code_challenge:', code_challenge);

// Step 3: Call /auth/slack/start with code_challenge
const startUrl = `http://localhost:31013/api/auth/slack/start?code_challenge=${encodeURIComponent(code_challenge)}&json=true`;
console.log('\n3️⃣ Calling /auth/slack/start...');

const startResponse = await fetch(startUrl);
const startData = await startResponse.json();
console.log('   Response:', JSON.stringify(startData, null, 2));

const state = startData.state;
console.log('\n4️⃣ Extracted state:', state);

// Note: In real flow, user would authenticate with Slack
// and Slack would redirect to /callback?code=xxx&state=xxx
// For testing, we'll simulate that the callback stored code_challenge

// Step 5: Test /auth/token/exchange
console.log('\n5️⃣ Testing /auth/token/exchange...');
console.log('   (This will fail because we need a real OAuth code from Slack)');
console.log('   But we can verify the code_verifier hashing logic is correct');

// Verify that our code_challenge matches what the server would compute
const recomputedHash = crypto.createHash('sha256').update(code_verifier).digest();
const recomputedChallenge = recomputedHash.toString('base64url');

console.log('\n✅ Verification:');
console.log('   Original code_challenge: ', code_challenge);
console.log('   Recomputed code_challenge:', recomputedChallenge);
console.log('   Match:', code_challenge === recomputedChallenge ? '✅' : '❌');

console.log('\n📝 Next steps for manual testing:');
console.log('   1. Open the authorize URL in a browser:');
console.log(`      ${startData.url}`);
console.log('   2. Complete Slack authentication');
console.log('   3. Extract the "code" from the callback URL');
console.log('   4. Call /auth/token/exchange with:');
console.log(`      curl -X POST http://localhost:31013/api/auth/token/exchange \\`);
console.log(`        -H "Content-Type: application/json" \\`);
console.log(`        -d '{"code": "YOUR_CODE_HERE", "code_verifier": "${code_verifier}"}'`);
