const expectedMajor = 20;
const current = process.versions.node || "unknown";
const major = Number.parseInt(current.split(".")[0] || "", 10);

if (major !== expectedMajor) {
  console.error(
    `Node ${expectedMajor}.x requis pour TaskNote. Version détectée: ${current}. Utilise \`nvm use\` avant de lancer build/lint/typecheck.`,
  );
  process.exit(1);
}

console.log(`Node version OK: ${current}`);
