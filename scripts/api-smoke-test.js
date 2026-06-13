#!/usr/bin/env node

console.log("TimOS-Agent v0.4+ requires authenticated API access.");
console.log("");
console.log("Use:");
console.log("  1. Copy config/auth.json.example to config/auth.json");
console.log("  2. Set a local secret token");
console.log("  3. node scripts/server.js");
console.log("  4. node scripts/api-auth-smoke-test.js");
console.log("");
console.log("This script (api-smoke-test.js) is deprecated for v0.4.");
process.exit(0);
