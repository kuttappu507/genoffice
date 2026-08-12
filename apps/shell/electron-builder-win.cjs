const base = require('./electron-builder.cjs')

module.exports = {
  ...base,
  nsis: {
    ...base.nsis,
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
  },
}
