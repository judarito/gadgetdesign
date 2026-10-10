import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { spawn } from 'node:child_process'

const roots = ['netlify', 'scripts', 'src', 'tests']
const extensions = new Set(['.js', '.mjs'])
const files = []

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (extensions.has(path.slice(path.lastIndexOf('.')))) files.push(path)
  }
}

for (const root of roots) await collect(root)

for (const file of files.sort()) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`La sintaxis no es válida: ${relative(process.cwd(), file)}`))
    })
  })
}

console.log(`✓ Sintaxis JavaScript válida en ${files.length} archivos.`)
