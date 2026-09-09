// Server-side proxy for the app's AI features.
//
// The whole reason this file exists: the Anthropic API key must never reach a
// browser. Anyone with dev tools open can read anything the page holds, and a
// leaked key bills to you until you notice. So the browser talks to this, and
// only this talks to Anthropic.
//
// Deploy target: Vercel / Netlify Functions / Cloudflare Pages Functions — any
// runtime that gives a Request and takes a Response.
//
// Required environment variables (set them in the host's dashboard, never in
// the repo):
//   ANTHROPIC_API_KEY   your key
//   SUPABASE_URL        e.g. https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY   the anon/publishable key
//
// npm i @anthropic-ai/sdk @supabase/supabase-js

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The model the app's prompts were written and tested against.
const MODEL = 'claude-opus-5';
const MAX_TOKENS = 8000;

// A prompt long enough to be a mistake, or an attempt to run up a bill.
const MAX_PROMPT_CHARS = 60_000;

// Crude but effective at household scale: a fixed window per user, in memory.
// It resets when the function instance recycles, which is fine — the job is
// stopping a runaway loop, not enforcing a quota. Move it to a table if this
// ever serves more than a handful of people.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = hits.get(userId);
  if (!entry || now > entry.resetAt) {
    hits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// An unauthenticated proxy is someone else's free API key, found by a scanner
// within days. Every request must carry a valid Supabase session token.
async function userIdFromRequest(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

// The app asks for JSON but models like to wrap it in prose or a code fence.
// Pull the outermost object out rather than failing the whole request.
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* fall through */ }
    }
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userId = await userIdFromRequest(req);
  if (!userId) return json({ error: 'Sign in first' }, 401);
  if (rateLimited(userId)) return json({ error: 'Too many requests — wait a minute' }, 429);

  let body: { prompt?: unknown; json?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const wantJson = body.json === true;
  if (!prompt.trim()) return json({ error: 'Nothing to send' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'That request is too large' }, 413);

  try {
    // Streaming because max_tokens is high enough that a non-streamed request
    // can outlive the platform's HTTP timeout on a long recipe.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();

    // Safety classifiers can decline a request: HTTP 200, no content.
    if (message.stop_reason === 'refusal') {
      return json({ error: 'The model declined that request.' }, 422);
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!wantJson) return json({ text });

    const data = extractJson(text);
    if (data === null) return json({ error: 'No structured answer came back' }, 502);
    return json({ data });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: 'The AI service is rate limiting — try again shortly' }, 429);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return json({ error: 'Couldn’t reach the AI service' }, 503);
    }
    // Never forward the raw error: it can carry request details, and on some
    // failures the key itself appears in an SDK message.
    console.error('[api/ai]', err);
    return json({ error: 'The AI service failed on that one' }, 500);
  }
}
