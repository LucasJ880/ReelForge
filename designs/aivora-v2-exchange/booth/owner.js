/* 店主台（iPad B / 笔记本）：收到留言 → 离线草稿库起草 → 店主批准（唯一的余烬键）/ 改了再发 / 不回复。
   每个进行中的状态都能「结束本轮」；约好后记一次真实跑通、生成访客自己的结果页二维码、店员记两个标签。
   一轮进行中又有新访客开始时先排队（连同他的留言），不抢走当前这一轮；回复发出后等客户手机回执，没收到就给「重发」。
   ?rehearsal：彩排模式，不计入展位计数。 */
(() => {
  "use strict";
  const B = window.Booth;
  const { esc, t, icon, catOf, draft, translateDraft, factLabel, chainHtml, mmss, recordRun, resultUrl, qrSvg, store, slotLabel, detectLang, isPrivateHost } = B;
  const rehearsal = /[?&]rehearsal\b/.test(location.search);

  function mount(root, bus, opts = {}) {
    let lang = opts.lang || B.uiLang("owner");
    const blank = () => ({ sid: null, cat: "blinds", city: "", comment: null, tComment: 0, d: null, tDraft: 0, mode: "idle", edit: null, attach: true, reply: null, tReply: 0, slot: null, tBook: 0, url: null, qual: null, code: null, acked: true, gone: false });
    let S = blank();
    let pending = null;     // 这一轮还没结束，下一位已经在 iPad A 上开始（连同他可能已经发出的留言）
    let ackTimer = null;
    let lastActivity = 0;
    const say = (msg) => { const r = opts.live || document.getElementById("sr-live"); if (r) { r.textContent = ""; requestAnimationFrame(() => (r.textContent = msg)); } };
    const since = (x) => (x && S.tComment ? mmss((x - S.tComment) / 1000) : "");
    const args = () => ({ cat: S.cat, city: S.city });

    function chain() {
      const m = S.mode;
      const reached = m === "idle" || m === "waiting" ? 2 : m === "drafting" ? 3 : ["draft", "edit", "blocked"].includes(m) ? 4 : m === "sent" ? 5 : m === "booked" ? 6 : 3;
      const now = { waiting: 2, drafting: 3, draft: 4, edit: 4, blocked: 4, sent: 5 }[m] ?? -1;
      return chainHtml({ reached, now, lang, cls: "chain pre", times: { comment: S.comment ? "0:00" : "", draft: since(S.tDraft), approve: since(S.tReply), booked: since(S.tBook) } });
    }
    const noFallback = () => { const f = B.config.leadFallback || {}; return !(f.email || f.whatsapp || f.wechat); };
    /* 征求同意的法律主体没填：结果页不开放线上登记。递二维码之前让店员知道，不让这一项「空着不说」 */
    const noEntity = () => { const e = B.config.consentEntity || {}; return !(e.name && e.email); };
    const endBtn = () => `<button type="button" class="btn btn-ghost" id="o-end">${icon("x")}${esc(t(lang, "endRound"))}</button>`;

    function flagsHtml(d) {
      return [
        d.flags.price ? `<span class="flag hand">${icon("hand")}${esc(t(lang, "flag_price"))}</span>` : "",
        d.flags.place ? `<span class="flag hand">${icon("map-pin")}${esc(t(lang, "flag_place"))}</span>` : "",
        d.flags.unknown ? `<span class="flag hand">${icon("hand")}${esc(t(lang, "flag_unknown"))}</span>` : "",
        d.flags.private ? `<span class="flag hand">${icon("lock")}${esc(t(lang, "flag_private"))}</span>` : "",
        d.flags.time ? `<span class="flag">${icon("timer")}${esc(t(lang, "flag_time"))}</span>` : "",
        d.flags.bot ? `<span class="flag">${icon("bot")}${esc(t(lang, "flag_bot"))}</span>` : "",
      ].join("");
    }

    function draftBlock() {
      const d = S.d;
      const editing = S.mode === "edit";
      const tr = d.text ? translateDraft(d, args(), lang) : "";
      const flags = d.flags ? flagsHtml(d) : "";
      const dl = d.lang === "zh" ? (d.script === "hant" ? "zh-Hant" : "zh-CN") : "en";
      return `<section class="o-sec" aria-labelledby="o-dh">
        <h2 id="o-dh"><span class="lvl ${d.level === "L3" ? "lvl-3" : ""}">${esc(d.level || "L2")}</span>${esc(editing ? t(lang, "replyMyself") : t(lang, "o_draft"))}<span class="chip">${icon("wifi-off")}${esc(t(lang, "o_offline"))}</span></h2>
        ${flags ? `<div class="flags">${flags}</div>` : ""}
        <div class="draft-box">
          ${editing ? `<label class="sr" for="o-edit">${esc(t(lang, "replyMyself"))}</label><textarea id="o-edit" maxlength="600" lang="${dl}">${esc(S.edit ?? d.text)}</textarea>` : `<div class="draft-text" lang="${dl}">${esc(d.text)}</div>`}
          ${tr ? `<div class="draft-tr"><b>${esc(t(lang, editing ? "o_origDraft" : "o_tr"))}</b> · ${esc(tr)}</div>` : ""}
          ${d.cites && d.cites.length ? `<div class="facts" role="group" aria-label="${esc(t(lang, "cites"))}">${d.cites.map((id) => `<span class="fact">${icon("info")}<b>${esc(id)}</b>${esc(factLabel(id, S.cat, lang))}</span>`).join("")}</div>` : ""}
        </div>
        <p class="o-note">${esc(t(lang, "sampleFacts"))}</p>
        ${S.gone ? `<p class="o-warn" role="status">${icon("triangle-alert")}${esc(t(lang, "o_custGone"))}</p>` : ""}
        <div class="o-acts">
          ${S.gone ? "" : editing
            ? `<button type="button" class="btn btn-key btn-lg" id="o-send">${icon("send")}${esc(t(lang, "sendMine"))}</button>
               <label class="tag-btn"><input type="checkbox" id="o-attach" ${S.attach ? "checked" : ""}>${esc(t(lang, "attachLink"))}</label>
               <button type="button" class="btn btn-ghost" id="o-back">${esc(t(lang, "cancelEdit"))}</button>`
            : `<button type="button" class="btn btn-key btn-lg" id="o-approve">${icon("check")}${esc(t(lang, "approve"))}</button>
               <button type="button" class="btn" id="o-edit-btn">${icon("user-round")}${esc(t(lang, "replyMyself"))}</button>
               <button type="button" class="btn btn-ghost" id="o-skip">${esc(t(lang, "dontReply"))}</button>`}
          ${endBtn()}
        </div>
      </section>`;
    }

    function draw(focusId) {
      const keep = focusId || (document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : "");
      const L = lang;
      let main = "";
      if (S.mode === "idle" || !S.sid) {
        main = `<section class="o-sec o-empty" id="o-top" tabindex="-1"><span class="chip">${icon("tablet")}${esc(t(L, "owner_title"))}</span><b>${esc(t(L, "o_idle_h"))}</b><span class="dim">${esc(t(L, "o_idle_p"))}</span></section>`;
      } else {
        main += `<section class="o-sec" id="o-top" tabindex="-1"><h2>${icon("message-circle")}${esc(t(L, "o_cmt"))}<span class="chip">${esc(catOf(S.cat)[L])} · ${esc(S.city)}</span></h2>
          ${S.comment ? `<div class="o-cmt" lang="${detectLang(S.comment, S.city) === "zh" ? "zh-CN" : "en"}">${esc(S.comment)}</div>` : `<div class="dim">${esc(t(L, "o_waiting"))}</div>`}
          ${S.mode === "waiting" ? `<div class="o-acts">${endBtn()}</div>` : ""}</section>`;
        if (S.mode === "drafting") main += `<section class="o-sec"><h2><span class="lvl">L2</span>${esc(t(L, "o_draft"))}</h2><div class="draft-box beam"><div class="draft-text dim">…</div></div><div class="o-acts">${endBtn()}</div></section>`;
        if (["draft", "edit"].includes(S.mode) && S.d) main += draftBlock();
        if (S.mode === "blocked") main += `<section class="o-sec"><h2>${icon("ban")}${esc(t(L, "o_blocked"))}</h2><div class="flags"><span class="flag block">${icon("shield-check")}${esc(t(L, "flag_block"))}</span></div>
          ${S.gone ? `<p class="o-warn" role="status">${icon("triangle-alert")}${esc(t(L, "o_custGone"))}</p>` : ""}
          <div class="o-acts">${S.gone ? "" : `<button type="button" class="btn" id="o-manual">${icon("user-round")}${esc(t(L, "replyMyself"))}</button><button type="button" class="btn btn-ghost" id="o-skip">${esc(t(L, "dontReply"))}</button>`}${endBtn()}</div></section>`;
        if (S.mode === "skipped") main += `<section class="o-sec o-empty"><b>${esc(t(L, "o_skipped"))}</b><button type="button" class="btn" id="o-next">${icon("rotate-ccw")}${esc(t(L, "o_next"))}</button></section>`;
        if (["sent", "booked"].includes(S.mode) && S.reply) {
          main += `<section class="o-sec" id="o-sent" tabindex="-1"><h2>${icon("circle-check")}${esc(t(L, "o_sent"))} · <span class="num">${since(S.tReply)}</span> · ${esc(t(L, "by_" + S.reply.by))}</h2><div class="draft-box"><div class="draft-text">${esc(S.reply.text)}</div></div>
            ${S.mode === "sent" && !S.acked ? `<p class="o-warn" role="status">${icon("triangle-alert")}${esc(t(L, "o_notDelivered"))}<button type="button" class="btn" id="o-resend">${icon("send")}${esc(t(L, "o_resend"))}</button></p>` : ""}
            ${S.mode === "sent" ? `<div class="o-meta">${S.reply.link ? `<span class="pulse" aria-hidden="true"></span>${esc(t(L, "o_waitBook"))}` : esc(t(L, "o_noLink"))}</div><div class="o-acts">${endBtn()}</div>` : ""}</section>`;
        }
        if (S.mode === "booked") {
          const lanOnly = S.url && isPrivateHost(S.url);
          main += `<section class="o-sec" aria-labelledby="o-bk" id="o-bks" tabindex="-1"><h2 id="o-bk">${icon("calendar-check")}${esc(t(L, "o_booked"))} · ${esc(slotLabel(S.slot, L))}</h2>
            <div class="qr-box"><div class="qr" id="o-qr">${S.url ? qrSvg(S.url) : `<span class="qr-wait">${esc(t(L, "o_qrMaking"))}</span>`}</div>
              <div class="qr-side"><b class="qr-title">${esc(t(L, "o_scan"))}</b><span class="dim">${esc(t(L, "o_scan_p"))}</span>
              <span class="qr-time num">${since(S.tBook)}</span><span class="dim">${esc(t(L, "elapsed"))} · ${esc(t(L, "simChannel"))}</span>
              ${lanOnly ? `<span class="o-warn" role="note">${icon("triangle-alert")}${esc(t(L, "o_lanWarn"))}</span>` : ""}
              ${noFallback() ? `<span class="o-warn" role="note">${icon("triangle-alert")}${esc(t(L, "o_noFallback"))}</span>` : ""}
              ${noEntity() ? `<span class="o-warn" role="note">${icon("triangle-alert")}${esc(t(L, "o_noEntity"))}</span>` : ""}</div></div>
            <div class="o-meta" id="o-qh">${esc(t(L, "o_qualify"))}</div>
            <div class="tags" role="group" aria-labelledby="o-qh">${t(L, "qual").map((q, i) => `<button type="button" class="tag-btn" id="qual-${i}" data-qual="${i}" aria-pressed="${S.qual === i}">${esc(q)}</button>`).join("")}</div>
            <div class="tags" role="group" aria-label="${esc(t(L, "o_code"))}">${["A", "B", "C"].map((c) => `<button type="button" class="tag-btn" id="code-${c}" data-code="${c}" aria-pressed="${S.code === c}" aria-label="${esc(t(L, "o_code"))} ${c}">${c}</button>`).join("")}</div>
            <div class="o-acts"><button type="button" class="btn" id="o-next">${icon("rotate-ccw")}${esc(t(L, "o_next"))}</button></div></section>`;
        }
      }
      const next = pending && S.sid ? `<p class="o-meta" role="status">${icon("info")}${esc(t(L, "o_nextReady"))}</p>` : "";
      root.innerHTML = `<div class="owner" lang="${L === "zh" ? "zh-CN" : "en"}"><section class="o-sec">${chain()}</section>${main}${next}</div>`;
      const f = keep && root.querySelector(`#${CSS.escape(keep)}`);
      if (f) f.focus({ preventScroll: true });
    }

    function setMode(m, focusId) { S.mode = m; draw(focusId); }

    function startDraft() {
      setMode("drafting", "o-end");
      const sid = S.sid;
      setTimeout(() => {
        if (S.sid !== sid || S.mode !== "drafting") return;
        S.d = draft({ text: S.comment, ...args() });
        S.tDraft = Date.now();
        bus.send("draft", { sid: S.sid, draft: S.d, t: S.tDraft });
        setMode(S.d.blocked ? "blocked" : "draft", S.d.blocked ? "o-manual" : "o-approve");
      }, B.reduce ? 0 : 700);
    }

    function endRound(reason) {
      clearTimeout(ackTimer);
      if (S.sid) bus.send("reset", { sid: S.sid, src: "owner", reason });
      adoptPending();
    }
    function adoptPending() {
      S = blank();
      if (pending) {
        const p = pending; pending = null;
        S = { ...blank(), sid: p.sid, cat: p.cat, city: p.city, mode: "waiting" };
        if (p.comment != null) { S.comment = p.comment; S.tComment = p.tComment; draw("o-top"); startDraft(); return; }
      }
      draw("o-top");
    }

    /* 回复发出后等客户手机回执；6 秒没到就提示并给「重发」（同一条消息、同一个时间戳，客户端不会重复显示） */
    function sendReply() {
      clearTimeout(ackTimer);
      S.acked = false;
      bus.send("reply", { sid: S.sid, text: S.reply.text, by: S.reply.by, link: S.reply.link, t: S.tReply });
      const sid = S.sid;
      ackTimer = setTimeout(() => { if (S.sid === sid && S.mode === "sent" && !S.acked) draw(); }, 6000);
    }

    function saveTags() {
      if (!S.sid) return;
      const list = store.get("booth.qualify", []).filter((x) => x.sid !== S.sid);
      list.push({ sid: S.sid, day: B.today(), qual: S.qual == null ? null : T_EN_QUAL[S.qual], code: S.code, url: S.url, at: new Date().toISOString() });
      store.set("booth.qualify", list.slice(-500));
      bus.send("qualify", { sid: S.sid, qual: S.qual, code: S.code });
    }
    const T_EN_QUAL = B.T.en.qual;

    async function onBooked(m, restoring) {
      S.slot = Number(m.slot) || null; S.tBook = m.t || Date.now();
      const secs = (S.tBook - S.tComment) / 1000;
      if (!restoring && !rehearsal) bus.send("stats", { stats: recordRun(secs) });
      setMode("booked", "o-bks");
      say(`${t(lang, "o_booked")} · ${slotLabel(S.slot, lang)}`);
      const payload = {
        v: 2, sid: S.sid, ul: lang, rl: S.d ? S.d.lang : detectLang(S.comment, S.city), c: S.cat, ci: S.city, q: S.comment, s: S.slot,
        td: Math.round((S.tDraft - S.tComment) / 1000), ta: Math.round((S.tReply - S.tComment) / 1000), tb: Math.round(secs),
        by: S.reply.by, r: S.reply.text, f: S.d && S.d.flags ? Object.keys(S.d.flags).filter((k) => S.d.flags[k]) : [], day: B.today(),
      };
      S.url = await resultUrl(payload, bus);
      draw();
      bus.send("done", { sid: S.sid, url: S.url, tb: payload.tb });
    }

    root.addEventListener("click", (e) => {
      if (e.target.closest("#o-approve")) {
        S.tReply = Date.now(); S.reply = { text: S.d.text, by: "approved", link: true };
        sendReply();
        setMode("sent", "o-sent"); return;
      }
      if (e.target.closest("#o-edit-btn")) { S.edit = S.d.text; setMode("edit", "o-edit"); return; }
      if (e.target.closest("#o-manual")) {
        const dl = detectLang(S.comment, S.city);
        S.d = { text: "", lang: dl, cites: [], flags: {}, level: "L2" }; S.edit = t(dl, "skel_hi");
        setMode("edit", "o-edit"); return;
      }
      if (e.target.closest("#o-resend")) { sendReply(); draw("o-sent"); return; }
      if (e.target.closest("#o-back")) { S.edit = null; setMode(S.d && S.d.text ? "draft" : "blocked", S.d && S.d.text ? "o-edit-btn" : "o-manual"); return; }
      if (e.target.closest("#o-send")) {
        const box = root.querySelector("#o-edit");
        const v = box.value.trim();
        if (!v) { box.focus(); return; }
        const attach = root.querySelector("#o-attach").checked;
        const by = S.d && S.d.text ? (v === S.d.text.trim() ? "approved" : "edited") : "manual";
        S.tReply = Date.now(); S.reply = { text: v, by, link: attach };
        sendReply();
        setMode("sent", "o-sent"); return;
      }
      if (e.target.closest("#o-skip")) { bus.send("skip", { sid: S.sid }); setMode("skipped", "o-next"); return; }
      if (e.target.closest("#o-end")) { endRound("owner-end"); return; }
      if (e.target.closest("#o-next")) { endRound("next"); return; }
      const q = e.target.closest("[data-qual]"); if (q) { S.qual = +q.dataset.qual; saveTags(); draw(q.id); return; }
      const c = e.target.closest("[data-code]"); if (c) { S.code = c.dataset.code; saveTags(); draw(c.id); }
    });
    /* 访客在店主台上看草稿、改回复时，告诉客户手机和大屏「这一轮还活着」 */
    const activity = () => {
      if (!S.sid || !["draft", "edit", "blocked", "sent"].includes(S.mode) || Date.now() - lastActivity < 20000) return;
      lastActivity = Date.now(); bus.send("activity", { sid: S.sid });
    };
    root.addEventListener("pointerdown", activity);
    root.addEventListener("input", (e) => { activity(); if (e.target.id === "o-edit") S.edit = e.target.value; });
    root.addEventListener("change", (e) => { if (e.target.id === "o-attach") S.attach = e.target.checked; });

    bus.on((m) => {
      if (m.type === "stats") { B.adoptStats(m.stats); return; }
      if (m.type === "state:req") { if (m.from !== bus.me) bus.send("stats", { stats: B.stats() }); return; }
      if (m.type === "session:start") {
        if (S.sid && S.sid !== m.sid && !["idle", "waiting", "skipped"].includes(S.mode)) { pending = { sid: m.sid, cat: m.cat, city: m.city, comment: null, tComment: 0 }; draw(); return; }
        clearTimeout(ackTimer); pending = null;
        S = { ...blank(), sid: m.sid, cat: m.cat, city: m.city, mode: "waiting" }; draw(); return;
      }
      /* 排队中的下一位：先把他的留言或重置记下来，店员点「下一位」时接着跑 */
      if (pending && m.sid === pending.sid) {
        if (m.type === "comment") { pending.comment = String(m.text || ""); pending.tComment = m.t || Date.now(); }
        if (m.type === "reset") pending = null;
        draw(); return;
      }
      /* 刷新后接回正在进行的那一轮 */
      if (m.type === "state" && !S.sid && m.step && m.step !== "setup" && m.sid) {
        S = { ...blank(), sid: m.sid, cat: m.cat, city: m.city, comment: m.comment, tComment: m.tComment || Date.now() };
        if (m.step === "ask" || (!m.comment)) { S.mode = "waiting"; draw(); return; }
        if (m.step === "waiting") { startDraft(); return; }
        S.d = draft({ text: S.comment, ...args() });
        if (m.reply) { S.reply = { text: m.reply.text, by: m.reply.by || "approved", link: m.reply.link !== false }; S.tReply = m.tReply || Date.now(); }
        if (["replied", "pick"].includes(m.step)) { setMode("sent"); return; }
        if (m.step === "booked" && S.reply) { onBooked({ slot: m.slot, t: m.tBook }, true); return; }
        draw(); return;
      }
      if (!S.sid || m.sid !== S.sid) return;
      if (m.type === "comment" && S.mode === "waiting") { S.comment = String(m.text || ""); S.tComment = m.t || Date.now(); say(`${t(lang, "o_cmt")}: ${S.comment}`); startDraft(); }
      if (m.type === "ack") { if (!S.acked) { S.acked = true; if (S.mode === "sent") draw(); } }
      if (m.type === "book" && S.mode === "sent") { S.acked = true; onBooked(m, false); }
      if (m.type === "reset" && m.src !== "owner" && S.mode !== "booked") {
        /* 客户手机闲置超时：店主台上还在看/改的回复先留着，提示这一轮可以结束了 */
        if (m.reason === "idle" && ["draft", "edit", "blocked"].includes(S.mode)) { S.gone = true; draw(); return; }
        clearTimeout(ackTimer); adoptPending();
      }
    });
    bus.onMode((md) => { if (md === "relay-open") bus.send("state:req", {}); });

    draw();
    return {
      setLang(l) { lang = l; draw(); },
      get state() { return S; },
      exportTags() { return store.get("booth.qualify", []); },
    };
  }

  window.BoothOwner = { mount };
})();
