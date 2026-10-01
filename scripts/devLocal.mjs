import { spawn } from 'node:child_process'
import { connect } from 'node:net'

const children = []

let stopping = false

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
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

const functions = spawn('netlify', ['functions:serve', '--offline', '--port', '9999'], {
  cwd: process.cwd(),
  env: { ...process.env, XDG_CONFIG_HOME: '/tmp/netlify-config' },
  stdio: 'inherit',
})
watch(functions)

try {
  await waitForPort(9999)
  watch(spawn('npm', ['run', 'dev:vite'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
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
