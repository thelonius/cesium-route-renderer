import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// __dirname replacement for ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const cesiumPkgPath = path.join(__dirname, '..', 'node_modules', 'cesium', 'package.json')
let cesiumPkg
try {
  cesiumPkg = JSON.parse(fs.readFileSync(cesiumPkgPath, 'utf8'))
} catch (e) {
  // ignore; not required for copying
}

const src = path.join(__dirname, '..', 'node_modules', 'cesium', 'Build', 'Cesium')
const dest = path.join(__dirname, '..', 'public', 'cesium')

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    console.warn(`Source Cesium assets not found at ${srcDir}. Run npm install first.`)
    return
  }
  fs.mkdirSync(destDir, { recursive: true })
  for (const item of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, item)
    const d = path.join(destDir, item)
    if (fs.statSync(s).isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

copyDir(src, dest)
console.log('Cesium static assets copied to public/cesium')
