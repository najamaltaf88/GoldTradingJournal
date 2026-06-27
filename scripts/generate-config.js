/**
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from .env (local) or process.env (Netlify).
 * Writes env-config.js for the browser — never put secrets in other files.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const outPath = path.join(root, "env-config.js");

function parseEnvFile(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadEnv() {
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    Object.assign(env, parseEnvFile(fs.readFileSync(envPath, "utf8")));
  }
  return env;
}

const env = loadEnv();
const url = env.SUPABASE_URL;
const anonKey = env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_ANON_KEY.\n" +
      "Add them to .env (copy from .env.example) or set Netlify environment variables."
  );
  process.exit(1);
}

const output =
  "// Auto-generated from .env — do not edit. Run: node scripts/generate-config.js\n" +
  "window.SUPABASE_CONFIG = {\n" +
  `  url: ${JSON.stringify(url)},\n` +
  `  anonKey: ${JSON.stringify(anonKey)}\n` +
  "};\n";

fs.writeFileSync(outPath, output, "utf8");
console.log("Generated env-config.js from .env");
