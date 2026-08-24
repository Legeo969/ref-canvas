const sharp = require("sharp");
const path = require("path");

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <rect width="128" height="128" rx="24" fill="#1a1e1f"/>
  <rect x="28" y="28" width="72" height="72" rx="10" fill="none" stroke="#3ab28f" stroke-width="6"/>
  <line x1="28" y1="56" x2="100" y2="56" stroke="#3ab28f" stroke-width="6"/>
  <line x1="56" y1="100" x2="56" y2="56" stroke="#3ab28f" stroke-width="6"/>
  <circle cx="78" cy="78" r="10" fill="#3ab28f"/>
</svg>`);

(async () => {
  const dir = path.join(__dirname, "icons");
  for (const size of [16, 48, 128]) {
    await sharp(svg).resize(size, size).png().toFile(path.join(dir, `icon-${size}.png`));
  }
  console.log("icons generated");
})();
