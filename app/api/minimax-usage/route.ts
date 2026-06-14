import { NextResponse } from 'next/server';

// MiniMax Token Plan quota, read so the dashboard can show when MiniMax is out of
// tokens (and is therefore falling back to Codex). The `general` model is the
// text/coding model the agents use; `current_interval_*` is the 5-hour rolling
// window (the one that 429s first), `current_weekly_*` is the weekly cap.
//
// Host MUST be api.minimaxi.com — the .io host rejects sk-cp- (coding plan) keys
// with {"status_code":2049,"invalid api key"}. Key + host come from .env.local.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ModelRemains = {
  model_name: string;
  end_time: number;
  remains_time: number; // ms until the current interval resets
  current_interval_status: number; // 1 = ok, 2 = exhausted (observed)
  current_interval_remaining_percent: number;
  current_weekly_status: number;
  current_weekly_remaining_percent: number;
};

export async function GET() {
  const key = process.env.MINIMAX_API_KEY;
  const host = process.env.MINIMAX_USAGE_HOST ?? 'api.minimaxi.com';
  if (!key) {
    return NextResponse.json(
      { ok: false, error: 'MINIMAX_API_KEY not set' },
      { status: 200 }
    );
  }

  try {
    const res = await fetch(`https://${host}/v1/token_plan/remains`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      // Don't let a slow MiniMax API stall the dashboard poll.
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json()) as {
      model_remains?: ModelRemains[];
      base_resp?: { status_code: number; status_msg: string };
    };

    if (data.base_resp && data.base_resp.status_code !== 0) {
      return NextResponse.json(
        { ok: false, error: data.base_resp.status_msg || 'minimax error' },
        { status: 200 }
      );
    }

    // The coding agents use the text model, reported as "general".
    const model =
      data.model_remains?.find((m) => m.model_name === 'general') ??
      data.model_remains?.[0];

    if (!model) {
      return NextResponse.json({ ok: false, error: 'no model_remains' }, { status: 200 });
    }

    const intervalPercent = model.current_interval_remaining_percent;
    const weeklyPercent = model.current_weekly_remaining_percent;
    // Interval exhausted (429s) when status 2 or 0% left. Weekly out is rarer.
    const exhausted = model.current_interval_status === 2 || intervalPercent <= 0;

    return NextResponse.json({
      ok: true,
      model: model.model_name,
      intervalPercent,
      weeklyPercent,
      exhausted,
      // ms until the 5-hour window resets (when MiniMax becomes usable again).
      intervalResetMs: model.remains_time,
      intervalResetAt: model.end_time,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
