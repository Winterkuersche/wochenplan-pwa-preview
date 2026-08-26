const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScripts(scriptPaths, seedContext = {}) {
  const context = vm.createContext({
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    ...seedContext
  });

  for (const relativePath of scriptPaths) {
    const absolutePath = path.join(process.cwd(), relativePath);
    const code = fs.readFileSync(absolutePath, 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
  }

  return context;
}

module.exports = {
  loadScripts
};
