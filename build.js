const fs = require("fs");
const path = require("path");
const { exec } = require('child_process');

async function* walk(dir) {
    for await (const d of await fs.promises.opendir(dir)) {
        const entry = path.join(dir, d.name);
        if (d.isDirectory()) yield* walk(entry);
        else if (d.isFile()) yield entry;
    }
}

async function newestModTime(dir) {
    let newest = 0;
    for await (const p of walk(dir)) {
        const { mtimeMs } = await fs.promises.stat(p);
        if (mtimeMs > newest) newest = mtimeMs;
    }
    return newest;
}

async function main() {
  var compiled = false;
  var baseImageUpdated = false;

  const srcModTime = await newestModTime('src');
  const distModTime = await newestModTime('dist');
  if (srcModTime > distModTime) {
    console.log('compiling...');
    try {
      await new Promise((resolve, reject) =>
        exec('npx tsc', (err) => err ? reject(err) : resolve()));
      compiled = true;
    } catch (err) {
      process.exit(1);
    }
  }

  const { packageModTime } = await fs.promises.stat('package.json');
  const { dockerfileModTime } = await fs.promises.stat('Dockerfile.baseimg');
  try {
    baseImageUpdated = await new Promise((resolve, reject) => {
      exec(`docker inspect -f "{{ .Created }}" a2k0001/tradebot-baseimg`, (err, stdout) => {
        if (err) {
          exec('npm run baseimg', (err) => err ? reject(err) : resolve(true));
        } else {
          const imageModDate = new Date(stdout).getTime();
          if (packageModTime > imageModDate || dockerfileModTime > imageModDate) {
            console.log('updating base image...');
            exec('npm run baseimg', (err) => err ? reject(err) : resolve(true));
          } else {
            resolve(false);
          }
        }
      });
    });
  } catch (err) {
    process.exit(1);
  }

  if (compiled || baseImageUpdated) {
    try {
      await new Promise((resolve, reject) => exec('docker compose build', (err) => err ? reject(err) : resolve()));
    } catch (err) {
      process.exit(1);
    }
  }

  process.exit(0);
}

main()