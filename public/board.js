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
    if (r.source === 'clerk' && r.partial) bits.push('Howard County only');
    if (r.voteFor > 1) bits.push(`Vote for ${r.voteFor}`);
    return bits.join(' · ');
  }

  // Signature of a race's numbers, used to flash races that just changed.
  const sig = (r) => r.cands.map((c) => c.votes).join(',');

  function tvCard(r, fresh) {
    const { sorted, line } = stats(r);
    const rows = sorted.map((c, i) => (isBoard(r) && i === r.voteFor ? `<div class="seatline">Top ${r.voteFor} win seats</div>` : '') + `
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

  function phoneCard(r, starred, fresh) {
    const { sorted, line, total } = stats(r);
    const sub = subLine(r);
    return `<article class="pcard ${fresh ? 'fresh' : ''}">
      <div class="pc-top"><div><h3>${esc(r.office)}</h3>${sub ? `<div class="psub">${sub}</div>` : ''}</div>
        <button class="star" data-star="${esc(r.id)}" aria-pressed="${starred}" aria-label="${starred ? 'Remove from' : 'Add to'} my races">${starred ? '★' : '☆'}</button></div>
      ${!total ? `<p class="pnames">${r.cands.map((c) => `${esc(c.name)}${c.party ? ` (${esc(c.party)})` : ''}`).join('<br>')}</p>` : sorted.map((c, i) => (isBoard(r) && i === r.voteFor ? `<div class="pseat">Top ${r.voteFor} win seats</div>` : '') + `<div class="prow ${c.lead ? 'lead' : ''}"><span class="n">${esc(c.name)}${c.party ? ` (${esc(c.party)})` : ''}</span><span class="p">${pct(c.pct)}</span><span class="v">${fmt.format(c.votes)}</span>
        <span class="pbar"><i class="${partyClass(c.party)}" style="width:${(c.pct * 100).toFixed(1)}%"></i></span></div>`).join('')}
      <div class="pcall">${line}</div>${r.detail ? `<details class="pdetail"><summary>Read the question</summary><p>${esc(r.detail)}</p></details>` : ''}</article>`;
  }

  // Ballots counted, turnout (needs registered voters), and share of the expected vote (needs HQ's estimate).
  function turnout(results, state) {
    const m = results?.meta || {};
    const ballots = m.ballotsCast;
    const registered = state?.registered || m.registered || null;
    const expected = state?.expected || null;
    return {
      ballots,
      registered,
      turnout: ballots != null && registered ? ballots / registered : null,
      share: ballots != null && expected ? Math.min(1, ballots / expected) : null,
      reportTime: m.reportTime ? m.reportTime.replace(/^\d{2}\/\d{2}\/\d{4}\s+/, '') : null,
    };
  }

  window.Board = { LEVELS, fmt, esc, pct, pct0, timeOf, getJSON, allRaces, isBoard, stats, subLine, sig, tvCard, phoneCard, turnout };
})();
