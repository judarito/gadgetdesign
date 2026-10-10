import { spawn } from 'node:child_process'
import { connect } from 'node:net'

const children = []
const functionsPort = Number(process.env.NETLIFY_FUNCTIONS_PORT || 9999)

if (!Number.isInteger(functionsPort) || functionsPort < 1024 || functionsPort > 65535) {
  throw new Error('NETLIFY_FUNCTIONS_PORT debe ser un puerto entero entre 1024 y 65535.')
}

let stopping = false

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.killed) continue
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
  setTimeout(() => process.exit(exitCode), 250)
}

function watch(child) {
  children.push(child)
  child.on('error', (error) => {
    console.error(error)
    stop(1)
  })
  child.on('exit', (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`El proceso local terminó inesperadamente (${signal || code}).`)
      stop(code || 1)
    }
  })
}

const functions = spawn('netlify', ['functions:serve', '--offline', '--port', String(functionsPort)], {
  cwd: process.cwd(),
  env: { ...process.env, XDG_CONFIG_HOME: '/tmp/netlify-config' },
  stdio: 'inherit',
  detached: true,
})
watch(functions)

try {
  await waitForPort(functionsPort)
  watch(spawn('npm', ['run', 'dev:vite'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    detached: true,
  }))
} catch (error) {
  console.error(error.message)
  stop(1)
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

async function waitForPort(port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
      socket.setTimeout(250, () => { socket.destroy(); resolve(false) })
    })
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Netlify Functions no inició en el tiempo esperado.')
}
