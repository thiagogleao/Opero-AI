export async function GET() {
  return Response.json({ status: 'ok', port: process.env.PORT, env: process.env.NODE_ENV })
}
