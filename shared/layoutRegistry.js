const fs = require('fs');
const path = require('path');

const layoutsDirectory = path.join(__dirname, 'layouts');
const layouts = Object.create(null);

for (const filename of fs.readdirSync(layoutsDirectory).filter(file => file.endsWith('.js')).sort()) {
  const layout = require(path.join(layoutsDirectory, filename));
  if (!layout || typeof layout.id !== 'string' || !layout.id ||
      typeof layout.name !== 'string' || !layout.name || !Array.isArray(layout.placements)) {
    throw new Error(`Invalid layout definition in shared/layouts/${filename}`);
  }
  if (Object.hasOwn(layouts, layout.id)) {
    throw new Error(`Duplicate layout id "${layout.id}" in shared/layouts/${filename}`);
  }
  layouts[layout.id] = layout;
}

if (Object.keys(layouts).length === 0) {
  throw new Error('No expedition layouts found in shared/layouts');
}

function listLayouts() {
  return Object.values(layouts).map(({ id, name, difficulty }) => ({ id, name, difficulty }));
}

module.exports = { layouts, listLayouts };
