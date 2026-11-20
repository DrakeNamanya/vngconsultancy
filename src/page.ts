export const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trade Order Study | Qualitative Evidence Dashboard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23142a46'/><path d='M7 22V10m6 12V14m6 8V8m6 14V16' stroke='%231f877d' stroke-width='3' stroke-linecap='round'/></svg>">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
</head>
<body>
<header id="topbar">
  <div class="brand"><i class="fa-solid fa-chart-column"></i>
    <div><h1>Trade Order Implementation Study</h1><p>Qualitative evidence pipeline &middot; KII &middot; FGD &middot; audio &middot; SDLG / VNG International</p></div></div>
  <div id="sync-info" class="sync-info"></div>
</header>
<nav id="filters">
  <label>Region <select id="f-region"><option value="">All</option></select></label>
  <label>Local government <select id="f-lg"><option value="">All</option></select></label>
  <label>Respondent group <select id="f-grp"><option value="">All</option><option value="official">Officials</option><option value="trader">Traders</option></select></label>
  <label class="chk"><input type="checkbox" id="f-demo"> Include demo data</label>
  <button id="btn-reset" class="ghost"><i class="fa-solid fa-rotate-left"></i> Reset</button>
  <span id="demo-banner" class="banner hidden"><i class="fa-solid fa-flask"></i> Demo data included in view</span>
</nav>
<nav id="tabs"></nav>
<main id="view"><div class="loading">Loading&hellip;</div></main>
<aside id="drawer" class="hidden"><div class="drawer-inner"><button id="drawer-close" class="ghost close"><i class="fa-solid fa-xmark"></i></button><div id="drawer-body"></div></div></aside>
<div id="toast" class="hidden"></div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="/static/app.js"></script>
</body></html>`
