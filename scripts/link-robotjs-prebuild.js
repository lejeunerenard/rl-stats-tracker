// Expose robotjs's node-gyp-build style prebuild (`node.napi[.<libc>].node`)
// under the name bare-addon-resolve looks for (`<name>.node`). Bare searches
// every `prebuilds/<host>/` directory from the package, so the symlink can be
// hit.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const host = `${process.platform}-${process.arch}`
const source = path.join(root, 'node_modules', 'robotjs', 'prebuilds', host)
const target = path.join(root, 'prebuilds', host, 'robotjs.node')

let files
try {
  files = fs.readdirSync(source).filter((f) => /^node\.napi(\.[a-z]+)?\.node$/.test(f))
} catch {
  files = []
}

// On Linux prefer the glibc build unless we're on musl.
const libc = fs.existsSync('/etc/alpine-release') ? 'musl' : 'glibc'
const file = files.find((f) => f.includes(`.${libc}.`)) || files[0]

if (!file) {
  console.warn(`robotjs: no prebuild for ${host} in ${source}, skipping`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.rmSync(target, { force: true })

try {
  fs.symlinkSync(path.relative(path.dirname(target), path.join(source, file)), target)
} catch {
  fs.copyFileSync(path.join(source, file), target) // e.g. Windows without symlink rights
}

console.log(`robotjs: ${path.relative(root, target)} -> ${file}`)
