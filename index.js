const axios = require("axios");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const util = require("util");
const stream = require("stream");
const child_process = require("child_process");
const _ = require("lodash");
const { writeFile, readFile } = require("fs/promises");
const rsa = require("node-rsa");
const { glob } = require("glob");

const pipeline = util.promisify(stream.pipeline);

const downloadAssets = async (tag) => {
  const url = `https://release.dreamacro.workers.dev/latest/`;
  const { data } = await axios.get(url).catch((e) => {
    console.error(e);
  });
  const assets = [...data.matchAll(/<a href="(.+?)">.+?<\/a>/g)].map(
    (i) => i[1]
  );
  if (assets.length > 0) {
    const missions = [];
    const filesPath = "./temp/files";
    for (const name of assets) {
      const downloadURL = `${url}${name}`;
      missions.push(downloadAsset(downloadURL, path.join(filesPath, name)));
    }

    const results = await Promise.allSettled(missions);
    const [s, f] = _.partition(results, ({ status }) => status === "fulfilled");
    if (f.length > 0) {
      console.log(`failed with error: ${f[0].value}`);
    } else {
      console.log(`all ${missions.length} missions success!`);
    }
  }
};

const downloadAsset = async (url, dest) => {
  try {
    const { data } = await axios.get(url, {
      responseType: "stream",
    });
    if (/\.gz$/.test(url)) {
      const gz = zlib.createGunzip();
      const ws = fs.createWriteStream(path.resolve(dest.slice(0, -3)));
      await pipeline(data, gz, ws);
      child_process.execSync(`chmod +x ${dest.slice(0, -3)}`);
      console.log(`${url} ✅`);
    } else if (/\.zip$/.test(url)) {
      const tmpFolderPath = `./temp/temp-${new Date().getTime()}`;
      try {
        fs.mkdirSync(tmpFolderPath);
      } catch (e) {}
      const tmpFilePath = path.join(tmpFolderPath, "f.zip");
      const tmp = fs.createWriteStream(tmpFilePath);
      await pipeline(data, tmp);
      child_process.execSync(
        `unzip -qo ${tmpFilePath} -d ${tmpFolderPath} && cp ${tmpFolderPath}/* ${path.dirname(
          dest
        )} && rm -rf ${tmpFolderPath}`
      );
      console.log(`${url} ✅`);
    }
  } catch (e) {
    console.error(e);
    console.log(`${url} ❌`);
  }
};

const privKey = process.env.PRIVATE_KEY;

const key = new rsa();
key.importKey(privKey, "pkcs8-private-pem");

const signFiles = async (files) => {
  await Promise.all(
    files.map(async (p) => {
      const fileData = await readFile(p);
      const sign = key.sign(fileData, "base64", "utf8");
      const filename = path.basename(p);
      await writeFile(`./signs/${filename}.sign`, sign);
      console.log(`sign ${p} success`);
    })
  );
};

const globPm = util.promisify(glob);

const initFolders = () => {
  const folders = ["temp/files", "signs"];
  for (const folder of folders) {
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (e) {}
  }
};

(async () => {
  initFolders();
  await downloadAssets();
  const files = await globPm("./temp/files/clash-*");
  await signFiles([...files]);
})();
