// Tests the Edge Function logic with a fake Deno runtime, fake Supabase client and fake Claude API.
// Run: node tests/edge-function.test.js   (requires: npm i typescript)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'workboard-ai', 'index.ts'), 'utf8');
const diagnostics = [];
const js = ts.transpileModule(source.replace(/^import .*$/m, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true
});
(js.diagnostics || []).forEach((d) => diagnostics.push(ts.flattenDiagnosticMessageText(d.messageText, '\n')));

function makeRuntime({ env = {}, user = { id: 'u1' }, approved = true, claude }) {
  let handler = null;
  const fetchCalls = [];
  const sandbox = {
    console: { error: () => {}, log: () => {} },
    Response, Request, Headers, AbortController, setTimeout, clearTimeout, JSON, String, Array, Error,
    Deno: { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', ...env })[k] }, serve: (fn) => { handler = fn; } },
    createClient: () => ({
      auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error('no user') }) },
      rpc: async () => ({ data: approved, error: null })
    }),
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      fetchCalls.push({ url, headers: init.headers, body });
      return claude(body);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(js.outputText, sandbox);
  const call = (body, { method = 'POST', auth = 'Bearer token', origin = 'https://heochanghoe.github.io' } = {}) =>
    handler(new Request('https://x.supabase.co/functions/v1/workboard-ai', {
      method,
      headers: { 'content-type': 'application/json', origin, ...(auth ? { authorization: auth } : {}) },
      body: method === 'POST' ? JSON.stringify(body) : undefined
    }));
  return { call, fetchCalls };
}

const ok = (input) => new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'x', input }] }), { status: 200 });
const results = [];
const check = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

(async () => {
  check('typescript: transpiles without syntax errors', diagnostics.length === 0, diagnostics.join(' | '));

  { // happy path: capture
    const rt = makeRuntime({ env: { ANTHROPIC_API_KEY: 'sk-test' }, claude: () => ok({ actions: [{ type: 'create_task', task: { name: '견적 회신' } }] }) });
    const res = await rt.call({ mode: 'capture', text: '내일 견적 회신', today: '2026-11-11', weekday: '수', projects: ['VAMS'], tasks: [], settings: {} });
    const data = await res.json();
    const sent = rt.fetchCalls[0];
    check('capture: returns actions', res.status === 200 && data.actions.length === 1 && data.actions[0].task.name === '견적 회신');
    check('capture: key sent to Claude only via header, forced tool use', sent.headers['x-api-key'] === 'sk-test' && sent.body.tool_choice.name === 'record_actions' && !JSON.stringify(sent.body).includes('sk-test'));
    check('capture: note and context included in prompt', sent.body.messages[0].content.includes('내일 견적 회신') && sent.body.messages[0].content.includes('VAMS') && sent.body.messages[0].content.includes('2026-11-11'));
    check('cors: allowed origin echoed', res.headers.get('access-control-allow-origin') === 'https://heochanghoe.github.io');
    check('response: key never appears in output', !JSON.stringify(data).includes('sk-test'));
  }
  { // meeting mode
    const rt = makeRuntime({ env: { ANTHROPIC_API_KEY: 'k' }, claude: () => ok({ title: '주간 회의', summary: ['a'], decisions: [], actionItems: [], openIssues: [] }) });
    const res = await rt.call({ mode: 'meeting', text: '회의 내용', today: '2026-11-11', projects: [], hint: { date: '2026-11-10' }, kind: 'transcript' });
    const data = await res.json();
    check('meeting: returns minutes', res.status === 200 && data.meeting.title === '주간 회의' && rt.fetchCalls[0].body.tool_choice.name === 'record_meeting' && rt.fetchCalls[0].body.messages[0].content.includes('2026-11-10'));
  }
  { // model fallback on 404
    let n = 0;
    const rt = makeRuntime({ env: { ANTHROPIC_API_KEY: 'k' }, claude: () => (n++ === 0 ? new Response('{"error":"not_found"}', { status: 404 }) : ok({ actions: [] })) });
    const res = await rt.call({ mode: 'capture', text: 'x' });
    const data = await res.json();
    check('model: falls back to the next model when one is unavailable', res.status === 200 && rt.fetchCalls.length === 2 && rt.fetchCalls[0].body.model !== rt.fetchCalls[1].body.model && data.model === rt.fetchCalls[1].body.model);
  }
  { // pinned model
    const rt = makeRuntime({ env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'my-model' }, claude: () => ok({ actions: [] }) });
    await rt.call({ mode: 'capture', text: 'x' });
    check('model: ANTHROPIC_MODEL secret overrides the default', rt.fetchCalls[0].body.model === 'my-model');
  }
  { // access control
    const noAuth = await makeRuntime({ env: { ANTHROPIC_API_KEY: 'k' }, claude: () => ok({}) }).call({ mode: 'capture', text: 'x' }, { auth: '' });
    const rtBadUser = makeRuntime({ env: { ANTHROPIC_API_KEY: 'k' }, user: null, claude: () => ok({}) });
    const badUser = await rtBadUser.call({ mode: 'capture', text: 'x' });
    const rtPending = makeRuntime({ env: { ANTHROPIC_API_KEY: 'k' }, approved: false, claude: () => ok({}) });
    const pending = await rtPending.call({ mode: 'capture', text: 'x' });
    check('access: no token -> 401', noAuth.status === 401);
    check('access: invalid session -> 401, Claude not called', badUser.status === 401 && rtBadUser.fetchCalls.length === 0);
    check('access: unapproved user -> 403, Claude not called', pending.status === 403 && rtPending.fetchCalls.length === 0);
  }
  { // input validation and failures
    const rt = makeRuntime({ env: { ANTHROPIC_API_KEY: 'k' }, claude: () => ok({ actions: [] }) });
    check('input: empty text -> 400', (await rt.call({ mode: 'capture', text: '   ' })).status === 400);
    check('input: oversized quick note -> 413', (await rt.call({ mode: 'capture', text: 'a'.repeat(8001) })).status === 413);
    check('input: unknown mode -> 400', (await rt.call({ mode: 'other', text: 'x' })).status === 400);
    check('input: nothing above reached Claude', rt.fetchCalls.length === 0);
    const noKey = await makeRuntime({ claude: () => ok({}) }).call({ mode: 'capture', text: 'x' });
    check('config: missing key -> 500 with clear message', noKey.status === 500 && /ANTHROPIC_API_KEY/.test((await noKey.json()).error));
    const apiDown = await makeRuntime({ env: { ANTHROPIC_API_KEY: 'k' }, claude: () => new Response('overloaded', { status: 529 }) }).call({ mode: 'capture', text: 'x' });
    check('upstream: Claude error -> 502', apiDown.status === 502);
    const pre = await rt.call(null, { method: 'OPTIONS' });
    check('cors: preflight -> 204', pre.status === 204);
    const other = await rt.call({ mode: 'capture', text: 'x' }, { origin: 'https://evil.example' });
    check('cors: unknown origin is not echoed', other.headers.get('access-control-allow-origin') === 'https://heochanghoe.github.io');
  }

  let failed = 0;
  results.forEach((r) => { if (!r.ok) failed += 1; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : '\n      ' + r.detail}`); });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
