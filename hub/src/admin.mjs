/**
 * 枢纽管理页：单文件 HTML，无构建步骤、无外部依赖。
 *
 * 安全：所有 /admin/* 接口都要求管理令牌（启动时打印）。
 * 页面从 URL 的 ?token= 里读令牌，之后用它调接口。
 */
export const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>lan-im 枢纽管理</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#181b21; --line:#2a2f38; --fg:#e6e8ec; --muted:#9aa3b2; --accent:#0891b2; --danger:#dc2626; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  header { display:flex; align-items:center; gap:12px; padding:16px 24px; border-bottom:1px solid var(--line); }
  h1 { font-size:16px; margin:0; font-weight:600; }
  .pill { font-size:12px; padding:2px 8px; border-radius:999px; background:var(--panel); color:var(--muted); border:1px solid var(--line); }
  main { max-width:960px; margin:0 auto; padding:24px; display:flex; flex-direction:column; gap:24px; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
  h2 { font-size:13px; margin:0 0 12px; color:var(--muted); font-weight:600; letter-spacing:.04em; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:500; font-size:12px; }
  tr:last-child td { border-bottom:none; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:var(--muted); }
  button { font:inherit; font-size:12px; padding:4px 10px; border-radius:6px; border:1px solid var(--line); background:#20242c; color:var(--fg); cursor:pointer; }
  button:hover { border-color:var(--accent); }
  button.danger { color:#fca5a5; border-color:#4b1f1f; }
  button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  .empty { color:var(--muted); font-size:13px; padding:8px 0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; }
  .stat { background:#12151a; border:1px solid var(--line); border-radius:10px; padding:12px; }
  .stat b { display:block; font-size:20px; font-weight:600; }
  .stat span { color:var(--muted); font-size:12px; }
  .err { color:#fca5a5; }
  input { font:inherit; font-size:13px; padding:6px 10px; border-radius:6px; border:1px solid var(--line); background:#12151a; color:var(--fg); width:280px; }
</style>
</head>
<body>
<header>
  <h1>lan-im 枢纽管理</h1>
  <span class="pill" id="hubId">—</span>
  <span class="pill" id="status">加载中</span>
</header>
<main>
  <section>
    <h2>概览</h2>
    <div class="grid">
      <div class="stat"><b id="nNodes">—</b><span>在线节点</span></div>
      <div class="stat"><b id="nQueue">—</b><span>离线队列（字节）</span></div>
      <div class="stat"><b id="nBlocked">—</b><span>封禁节点</span></div>
    </div>
  </section>

  <section>
    <h2>节点</h2>
    <table>
      <thead><tr><th>账号</th><th>keyId</th><th>状态</th><th>最近活跃</th><th></th></tr></thead>
      <tbody id="nodes"><tr><td colspan="5" class="empty">加载中…</td></tr></tbody>
    </table>
  </section>

  <section>
    <h2>封禁名单</h2>
    <table>
      <thead><tr><th>keyId</th><th></th></tr></thead>
      <tbody id="blocked"><tr><td colspan="2" class="empty">暂无</td></tr></tbody>
    </table>
    <div style="margin-top:12px;display:flex;gap:8px">
      <input id="blockInput" placeholder="输入 keyId 后封禁" />
      <button class="danger" id="blockBtn">封禁</button>
    </div>
    <div class="err" id="err"></div>
  </section>
</main>
<script>
  const token = new URLSearchParams(location.search).get('token') || '';
  const api = async (path, init = {}) => {
    const res = await fetch(path, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), 'x-admin-token': token },
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    return res.json();
  };
  const fmtTime = (ms) => ms ? new Date(ms).toLocaleString() : '—';
  const short = (s) => s && s.length > 12 ? s.slice(0, 8) + '…' : (s || '—');

  async function refresh() {
    try {
      const [health, nodes, blocked] = await Promise.all([
        api('/health'), api('/admin/nodes'), api('/admin/blocked'),
      ]);
      document.getElementById('hubId').textContent = health.hubId || 'hub';
      document.getElementById('status').textContent = '运行中';
      document.getElementById('nNodes').textContent = String(nodes.filter(n => n.online).length);
      document.getElementById('nQueue').textContent = String(health.queueBytes ?? 0);
      document.getElementById('nBlocked').textContent = String(blocked.length);

      const nbody = document.getElementById('nodes');
      nbody.innerHTML = nodes.length === 0
        ? '<tr><td colspan="5" class="empty">还没有节点接入</td></tr>'
        : nodes.map(n => '<tr>' +
            '<td>' + (n.account || '—') + '</td>' +
            '<td><code>' + short(n.keyId) + '</code></td>' +
            '<td>' + (n.online ? '在线' : '离线') + '</td>' +
            '<td>' + fmtTime(n.seen) + '</td>' +
            '<td><button class="danger" data-keyid="' + n.keyId + '">封禁</button></td>' +
          '</tr>').join('');
      nbody.querySelectorAll('button[data-keyid]').forEach(btn => {
        btn.addEventListener('click', () => block(btn.dataset.keyid));
      });

      const bbody = document.getElementById('blocked');
      bbody.innerHTML = blocked.length === 0
        ? '<tr><td colspan="2" class="empty">暂无</td></tr>'
        : blocked.map(k => '<tr><td><code>' + short(k) + '</code></td>' +
            '<td><button data-unblock="' + k + '">解封</button></td></tr>').join('');
      bbody.querySelectorAll('button[data-unblock]').forEach(btn => {
        btn.addEventListener('click', () => unblock(btn.dataset.unblock));
      });
      document.getElementById('err').textContent = '';
    } catch (e) {
      document.getElementById('status').textContent = '接口错误';
      document.getElementById('err').textContent = String(e.message || e);
    }
  }

  async function block(keyId) {
    if (!keyId) return;
    try {
      await api('/admin/block', { method: 'POST', body: JSON.stringify({ keyId }) });
      await refresh();
    } catch (e) { document.getElementById('err').textContent = String(e.message || e); }
  }
  async function unblock(keyId) {
    try {
      await api('/admin/unblock', { method: 'POST', body: JSON.stringify({ keyId }) });
      await refresh();
    } catch (e) { document.getElementById('err').textContent = String(e.message || e); }
  }

  document.getElementById('blockBtn').addEventListener('click', () => {
    const input = document.getElementById('blockInput');
    block(input.value.trim());
    input.value = '';
  });

  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>`
