export default async function handler() {
  return new Response(JSON.stringify({
    status: 'ok',
    environment: process.env.CONTEXT || process.env.NODE_ENV || 'unknown',
    commit: process.env.COMMIT_REF || process.env.HEAD || null,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
