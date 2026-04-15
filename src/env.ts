// Side-effect-only prelude. Must be the FIRST import of every entry point
// (api/server.ts, worker/index.ts) so that process.loadEnvFile() runs
// *before* any other module's top-level code reads from process.env.
//
// Why this file exists: ES module imports are hoisted and evaluated before
// the importing module's own body. That means a try/catch at the top of
// server.ts that calls process.loadEnvFile() runs AFTER every imported
// module's top-level code, so any `const X = process.env.Y ?? default` at
// module init would see a missing value and silently fall back to the
// default — even though .env has the variable set.
//
// By putting loadEnvFile() inside its own module and importing it first,
// the ES module linker runs this file's side effect before running any
// other import's top-level code. process.env is then populated for every
// downstream module init.
try {
  process.loadEnvFile();
} catch {
  // .env doesn't exist — fine, we'll use whatever's in the shell env and
  // rely on hardcoded defaults for the rest.
}
