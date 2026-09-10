// Server-side proxy for the app's AI features.
//
// The whole reason this file exists: the Anthropic API key must never reach a
// browser. Anyone with dev tools open can read anything the page holds, and a
// leaked key bills to you until you notice. So the browser talks to this, and
// only this talks to Anthropic.
//
// Deploy target: Vercel's Edge runtime, declared below. The Web-standard
// Request/Response signature is what Edge takes; Vercel's Node runtime uses a
// different (req, res) shape, so the `config` export is not optional.
//
// For Netlify: move this to netlify/functions/ai.mts and change the export to
// `export default async (req: Request) => {}` plus
// `export const config = { path: "/api/ai" }`.
// For Cloudflare Pages: move to functions/api/ai.ts and export
// `export const onRequestPost: PagesFunction = ({ request, env }) => handler(request)`,
// reading the keys off `env` rather than process.env.
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

export const config = { runtime: 'edge' };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The model the app's prompts were written and tested against.
const MODEL = 'claude-opus-5';

// Effort is the first lever on how long a request takes, and these jobs do not
// all deserve the same amount of thinking. Pulling a recipe out of text that is
// already in front of it is not the same problem as rewriting a method without
// breaking an allergy note, and a bulk PDF import runs the first one twenty
// times in a row.
//
// max_tokens is per job too: a macro estimate is four numbers, not an essay,
// and an over-large ceiling costs latency even when it goes unused.
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

type Effort = 'low' | 'medium' | 'high';
const TASKS: Record<string, { effort: Effort; maxTokens: number }> = {
  extract:     { effort: 'low',    maxTokens: 4000 },  // recipe out of PDF text
  linkDraft:   { effort: 'low',    maxTokens: 3000 },
  macros:      { effort: 'low',    maxTokens: 700  },
  pantrySort:  { effort: 'low',    maxTokens: 1500 },
  pantryMatch: { effort: 'low',    maxTokens: 3000 },  // tidy the grocery list
  adjust:      { effort: 'medium', maxTokens: 6000 },  // rewrites a method
  assistant:   { effort: 'medium', maxTokens: 6000 },  // must not guess a meal
};
const DEFAULT_TASK = { effort: 'medium' as Effort, maxTokens: 4000 };

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

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error('[api/ai] SUPABASE_URL or SUPABASE_ANON_KEY is not set');
    return null;
  }
  const supabase = createClient(url, anonKey);
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

  let body: { prompt?: unknown; task?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return json({ error: 'Nothing to send' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'That request is too large' }, 413);

  const taskName = typeof body.task === 'string' ? body.task : '';
  const task = TASKS[taskName] || DEFAULT_TASK;

  try {
    // Streamed, and streamed all the way to the browser. Buffering the whole
    // reply here means no bytes leave until the model has finished, and a
    // platform that expects a first byte within ~25 seconds kills the request
    // — which is what "taking too long to connect" was. Once bytes are
    // flowing the clock stops mattering.
    //
    // No `thinking` parameter: Opus 5 runs adaptive thinking by default, and
    // the older fixed-budget form is rejected on this model.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: task.maxTokens,
      output_config: { effort: task.effort },
      messages: [{ role: 'user', content: prompt }],
    });

    const encoder = new TextEncoder();
    const out = new ReadableStream<Uint8Array>({
      async start(controller) {
        // A space first, immediately. It costs nothing, it is ignored by both
        // JSON.parse and the plain-text path, and it starts the clock on the
        // response rather than on the model.
        controller.enqueue(encoder.encode(' '));
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          const message = await stream.finalMessage();
          if (message.stop_reason === 'refusal') {
            // The status is long gone, so say it in the body. The client shows
            // this rather than failing to parse an empty answer.
            controller.enqueue(encoder.encode('\n\n[[MP_ERROR]] The model declined that request.'));
          }
        } catch (err) {
          console.error('[api/ai] mid-stream', err);
          controller.enqueue(encoder.encode('\n\n[[MP_ERROR]] The AI service dropped that one — try again.'));
        }
        controller.close();
      },
      cancel() { stream.abort(); },
    });

    return new Response(out, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        // Some proxies buffer a response unless told not to, which would put
        // the timeout straight back.
        'X-Accel-Buffering': 'no',
      },
    });
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
