// Shared pieces for the TV, phone, and control pages.
(function () {
  const LEVELS = ['Federal and state', 'Statehouse', 'County', 'Township and town'];
  const fmt = new Intl.NumberFormat('en-US');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x) => (x * 100).toFixed(1) + '%';
  const pct0 = (x) => Math.round(x * 100) + '%';
  const partyClass = (p) => (p === 'D' ? 'D' : p === 'R' ? 'R' : 'O');
  const timeOf = (iso) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

  async function getJSON(url, opts) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // Results from the feeds plus anything HQ typed in by hand, in ballot-ish order.
  function allRaces(results, state) {
    const hand = (state?.hand || []).map((h) => ({ ...h, source: 'hand' }));
    const list = [...(results?.races || []), ...hand];
    return list
      .map((r, i) => ({ r, i }))
      .sort((a, b) => LEVELS.indexOf(a.r.level) - LEVELS.indexOf(b.r.level) || a.i - b.i)
      .map((x) => x.r);
  }

  const isBoard = (r) => r.voteFor > 1;

  function stats(r) {
    const total = r.cands.reduce((a, c) => a + c.votes, 0);
    const sorted = [...r.cands].sort((a, b) => b.votes - a.votes).map((c, i) => ({ ...c, pct: total ? c.votes / total : 0, lead: total > 0 && i < r.voteFor }));
    let line = 'No votes counted yet';
    if (total) {
      const a = sorted[r.voteFor - 1], b = sorted[r.voteFor];
      const gap = a.votes - b.votes;
      line = gap === 0 ? `<b>Tied</b> for ${r.voteFor > 1 ? 'the last seat' : 'the lead'}` : `<b>${esc(a.name)}</b> ${r.voteFor > 1 ? 'holds the last seat' : 'leads'} by <b>${fmt.format(gap)}</b>`;
    }
    return { total, sorted, line };
  }

  function subLine(r) {
    const bits = [];
    if (r.source === 'state') bits.push(r.scope === 'statewide' ? 'Statewide' : 'Whole district');
    if (r.source === 'hand') bits.push('Entered by HQ');
    if (r.source === 'clerk' && r.partial && !r.backup) bits.push('Howard County only');
    if (r.backup) bits.push('Backup count from civicAPI');
    if (r.voteFor > 1) bits.push(`Vote for ${r.voteFor}`);
    return bits.join(' · ');
  }

  // Signature of a race's numbers, used to flash races that just changed.
  const sig = (r) => r.cands.map((c) => c.votes).join(',');

  function tvCard(r, fresh) {
    const { sorted, line, total } = stats(r);
    // No votes yet: just the names, in ballot order.
    const rows = !total ? r.cands.map((c) => `<div class="trow"><span class="n">${esc(c.name)}${c.party ? `<small>${esc(c.party)}</small>` : ''}</span></div>`).join('') : sorted.map((c, i) => (isBoard(r) && i === r.voteFor ? `<div class="seatline">Top ${r.voteFor} win seats</div>` : '') + `
      <div class="trow ${c.lead ? 'lead' : ''}">
        <span class="n">${esc(c.name)}${c.party ? `<small>${esc(c.party)}</small>` : ''}</span>
        <span class="p">${pct(c.pct)}</span>
        <span class="v">${fmt.format(c.votes)}</span>
        <span class="tbar"><i class="${partyClass(c.party)}" style="width:${(c.pct * 100).toFixed(1)}%"></i></span>
      </div>`).join('');
    const sub = subLine(r);
    return `<article class="tcard ${isBoard(r) ? 'tall' : ''} ${fresh ? 'fresh' : ''}" data-id="${esc(r.id)}">
      <h3>${esc(r.office)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}
      ${rows}<div class="call">${line}</div></article>`;
  }


  // ---------- extra panels on phone cards: results by county, and the count over the night (from civicAPI) ----------
  const panels = { open: new Map(), data: new Map() }; // race id -> 'county' | 'time';  `${kind}:${civicId}` -> { at, d }
  const sideTop = (cands, p) => cands.filter((c) => c.party === p).sort((a, b) => b.votes - a.votes)[0] || null;
  function panelButtons(r) {
    if (!r.civicId) return '';
    const wide = r.scope === 'district' || r.scope === 'statewide';
    const open = panels.open.get(r.id);
    const btn = (kind, label) => `<button type="button" class="pmore" data-panel="${kind}" data-race="${esc(r.id)}" data-civic="${esc(r.civicId)}" aria-expanded="${open === kind}">${label}</button>`;
    return `<div class="pmores">${wide ? btn('county', 'By county') : ''}${btn('time', 'Over the night')}</div>`;
  }
  function countyPanel(r, d) {
    const rows = d.counties.map((c) => {
      const tot = c.cands.reduce((a, x) => a + x.votes, 0), D = sideTop(c.cands, 'D'), R = sideTop(c.cands, 'R');
      return { name: c.name, pct: c.pct, tot, d: D ? D.votes : 0, r: R ? R.votes : 0 };
    });
    if (!rows.length) return '<p class="note">No county breakdown for this race.</p>';
    const share = (x, t) => (t ? pct(x / t) : '—');
    const how = rows.find((x) => x.name === 'Howard');
    let summary = '';
    if (how && rows.length > 1) {
      const rest = rows.filter((x) => x !== how).reduce((a, x) => ({ d: a.d + x.d, r: a.r + x.r, tot: a.tot + x.tot }), { d: 0, r: 0, tot: 0 });
      summary = how.tot || rest.tot ? `<p class="psum">Howard County: <b>${share(how.d, how.tot)}</b> D · rest of the ${r.scope === 'statewide' ? 'state' : 'district'}: <b>${share(rest.d, rest.tot)}</b> D</p>` : '';
    }
    const body = rows.sort((a, b) => b.tot - a.tot || a.name.localeCompare(b.name)).map((x) => `<tr class="${x.name === 'Howard' ? 'how' : ''}"><td>${esc(x.name)}</td><td class="D">${share(x.d, x.tot)}</td><td class="R">${share(x.r, x.tot)}</td><td>${x.pct}%</td></tr>`).join('');
    const map = `<img class="pmap" src="/api/breakdown?id=${encodeURIComponent(r.civicId)}&map=1${SAMPLE ? '&test=1' : ''}" alt="Map of ${esc(r.office)} results by county" loading="lazy" onerror="this.remove()">`;
    return `${summary}${map}<div class="ptable"><table><thead><tr><th>County</th><th>D</th><th>R</th><th>In</th></tr></thead><tbody>${body}</tbody></table></div>${d.test ? '<p class="note">Practice numbers, not real results.</p>' : !d.live ? '<p class="note">County numbers show after polls close.</p>' : ''}`;
  }
  function timePanel(r, d) {
    const pts = d.points.map((p) => {
      const tot = p.cands.reduce((a, x) => a + x.votes, 0), D = sideTop(p.cands, 'D'), R = sideTop(p.cands, 'R');
      return { t: Date.parse(p.t), pct: p.pct, tot, m: tot && D && R ? ((D.votes - R.votes) / tot) * 100 : null };
    }).filter((p) => p.tot > 0);
    if (pts.length < 2) return '<p class="note">No vote updates yet. This fills in as counts come in.</p>';
    const W = 300, H = 74, pad = 4, t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const multi = r.voteFor > 1 || pts.some((p) => p.m == null);
    const vals = pts.map((p) => (multi ? p.tot : p.m));
    const lim = multi ? Math.max(...vals) : Math.max(5, ...vals.map((v) => Math.abs(v)));
    const x = (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (W - pad * 2);
    const y = (v) => (multi ? H - pad - (v / (lim || 1)) * (H - pad * 2) : H / 2 - (v / lim) * (H / 2 - pad));
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(multi ? p.tot : p.m).toFixed(1)}`).join('');
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const time = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const now = multi ? `${fmt.format(last.tot)} votes counted` : `${last.m >= 0 ? 'D' : 'R'} +${Math.abs(last.m).toFixed(1)} now`;
    return `<svg class="pspark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${multi ? 'Votes counted' : 'Lead'} over the night">
      ${multi ? '' : `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="zero"/>`}<path d="${path}" class="line" fill="none"/>
      <circle cx="${x(last.t).toFixed(1)}" cy="${y(multi ? last.tot : last.m).toFixed(1)}" r="3" class="dot"/></svg>
      <p class="psum">${esc(now)} · ${last.pct}% in · last update ${time(last.t)} added ${fmt.format(Math.max(0, last.tot - prev.tot))} votes</p>
      <p class="note">${multi ? 'Total votes counted' : 'Democratic lead (above the line) or Republican lead (below)'} from ${time(t0)} to ${time(t1)}.</p>`;
  }
  function panelHtml(r) {
    const kind = panels.open.get(r.id);
    if (!kind) return '';
    const hit = panels.data.get(`${kind}:${r.civicId}`);
    const inner = !hit ? '<p class="note">Loading…</p>' : hit.d.error ? `<p class="note">${esc(hit.d.error)}</p>` : kind === 'county' ? countyPanel(r, hit.d) : timePanel(r, hit.d);
    return `<div class="ppanel">${inner}</div>`;
  }
  // Opens or closes a panel; loads (or refreshes after a minute) its data, then calls rerender.
  async function togglePanel(btn, rerender) {
    const id = btn.dataset.race, kind = btn.dataset.panel, civicId = btn.dataset.civic;
    if (panels.open.get(id) === kind) { panels.open.delete(id); return rerender(); }
    panels.open.set(id, kind); rerender();
    const key = `${kind}:${civicId}`, hit = panels.data.get(key);
    if (hit && Date.now() - hit.at < 60000) return;
    const path = kind === 'county' ? `/api/breakdown?id=${encodeURIComponent(civicId)}${SAMPLE ? '&test=1' : ''}` : `/api/timeline?id=${encodeURIComponent(civicId)}`;
    try { panels.data.set(key, { at: Date.now(), d: await getJSON(path) }); } catch (e) { panels.data.set(key, { at: Date.now(), d: { error: "Couldn't load this right now." } }); }
    rerender();
  }

  function phoneCard(r, starred, fresh) {
    const { sorted, line, total } = stats(r);
    const sub = subLine(r);
    return `<article class="pcard ${fresh ? 'fresh' : ''}">
      <div class="pc-top"><div><h3>${esc(r.office)}</h3>${sub ? `<div class="psub">${sub}</div>` : ''}</div>
        <button class="star" data-star="${esc(r.id)}" aria-pressed="${starred}" aria-label="${starred ? 'Remove from' : 'Add to'} my races">${starred ? '★' : '☆'}</button></div>
      ${!total ? `<p class="pnames">${r.cands.map((c) => `${esc(c.name)}${c.party ? ` (${esc(c.party)})` : ''}`).join('<br>')}</p>` : sorted.map((c, i) => (isBoard(r) && i === r.voteFor ? `<div class="pseat">Top ${r.voteFor} win seats</div>` : '') + `<div class="prow ${c.lead ? 'lead' : ''}"><span class="n">${esc(c.name)}${c.party ? ` (${esc(c.party)})` : ''}</span><span class="p">${pct(c.pct)}</span><span class="v">${fmt.format(c.votes)}</span>
        <span class="pbar"><i class="${partyClass(c.party)}" style="width:${(c.pct * 100).toFixed(1)}%"></i></span></div>`).join('')}
      <div class="pcall">${line}</div>${r.detail ? `<details class="pdetail"><summary>Read the question</summary><p>${esc(r.detail)}</p></details>` : ''}${panelButtons(r)}${panelHtml(r)}</article>`;
  }

  // Ballots counted, turnout (needs registered voters), and share of the expected vote (needs HQ's estimate).
  function turnout(results, state) {
    const m = results?.meta || {};
    const ballots = m.ballotsCast;
    const registered = state?.registered || m.registered || null;
    const expected = state?.expected || null;
    const p = m.precincts && m.precincts.of ? m.precincts : null;
    const final = !!p && p.n >= p.of; // every Election Day precinct in: the expected-vote estimate has done its job
    return {
      ballots,
      registered,
      turnout: ballots != null && registered ? ballots / registered : null,
      share: !final && ballots != null && expected ? Math.min(1, ballots / expected) : null,
      final,
      reportTime: m.reportTime ? m.reportTime.replace(/^\d{2}\/\d{2}\/\d{4}\s+/, '') : null,
      precincts: m.precincts && m.precincts.of ? m.precincts : null, // Election Day precincts reporting, from the clerk
    };
  }

  // ?sample in the page address: preview November with made-up numbers.
  const SAMPLE = new URLSearchParams(location.search).has('sample');
  const api = (path) => (SAMPLE ? path + (path.includes('?') ? '&' : '?') + 'sample=1' : path);
  const keep = (href) => (SAMPLE ? href + (href.includes('?') ? '&' : '?') + 'sample' : href);

  window.Board = { togglePanel, SAMPLE, api, keep, LEVELS, fmt, esc, pct, pct0, timeOf, getJSON, allRaces, isBoard, stats, subLine, sig, tvCard, phoneCard, turnout };
})();
