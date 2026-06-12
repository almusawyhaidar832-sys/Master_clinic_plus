#!/usr/bin/env node
/**
 * Generate VAPID keys for Web Push (doctor mobile alerts).
 * Add output to .env.local — never commit private key.
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("Add these to .env.local:\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:your-email@example.com");
