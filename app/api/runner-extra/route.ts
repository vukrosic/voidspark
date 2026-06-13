import { getRunnerExtra, setRunnerExtra } from '@/lib/runnerExtra';

// GET-ish read (POST with no body) + save. The dashboard reads the current extra
// instructions on load and writes them when the operator edits the box.
export async function POST(req: Request) {
  let body: { text?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* read-only tick */
  }

  if (typeof body.text === 'string') {
    await setRunnerExtra(body.text);
  }

  const text = await getRunnerExtra();
  return Response.json({ success: true, text }, { status: 200 });
}
