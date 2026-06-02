const { spawn } = require("child_process");

const nextCli = require.resolve("next/dist/bin/next");
const args = [nextCli, "dev", ...process.argv.slice(2)];

const child = spawn(process.execPath, args, {
  stdio: ["inherit", "inherit", "pipe"],
  shell: false,
  env: {
    ...process.env,
    BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
    BROWSERSLIST_IGNORE_OLD_DATA: "1",
  },
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    if (!line) {
      process.stderr.write("\n");
      continue;
    }
    if (line.includes("[baseline-browser-mapping] The data in this module is over two months old.")) {
      continue;
    }
    process.stderr.write(`${line}\n`);
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
