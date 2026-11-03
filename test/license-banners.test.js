const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { licenseCatalog } = require("../server");

const expectedBanners = {
  firearms: "/assets/license-firearms-hunting.webp",
  motor: "/assets/license-motor.webp",
  "commercial-vehicle": "/assets/license-commercial.webp",
  boating: "/assets/license-boating.webp",
  fishing: "/assets/license-fishing.webp",
  hunting: "/assets/license-firearms-hunting.webp"
};

test("each license uses its supplied local banner", () => {
  assert.deepEqual(
    Object.fromEntries(licenseCatalog.map((license) => [license.id, license.bannerUrl])),
    expectedBanners
  );
});

test("all license banners are valid local WebP assets in both portal copies", () => {
  const projectRoot = path.resolve(__dirname, "..");
  for (const filename of new Set(Object.values(expectedBanners).map((url) => path.basename(url)))) {
    for (const publicDirectory of ["public", path.join("nyrp", "public")]) {
      const file = fs.readFileSync(path.join(projectRoot, publicDirectory, "assets", filename));
      assert.equal(file.subarray(0, 4).toString("ascii"), "RIFF", filename);
      assert.equal(file.subarray(8, 12).toString("ascii"), "WEBP", filename);
    }
  }
});
