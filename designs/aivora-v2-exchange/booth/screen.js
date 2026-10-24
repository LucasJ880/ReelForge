/* 大屏（过道模式）：无访客时轮播，主张屏（中英交替）穿插在证据 / Offer / 安全阀 / 渠道之间，一轮 76 秒；
   有访客在 iPad 上跑时切到实时链路（全程标「模拟渠道」）；约好后停 15 秒再回轮播；无人操作的一轮会被看门狗收掉。
   底栏只放本展位真实计数与真实试点计数（零就写零，关联方与截至日期写明），不放示例数字；全程无声。 */
(() => {
  "use strict";
  const B = window.Booth;
  const { esc, t, icon, chainHtml, mmss, stats, adoptStats, MARK, L10, splitDraft, maskContact } = B;
  const DWELL = { claim: 8000, other: 11000 };
  const PIN = ["claim", "proof", "offer", "safety", "channels"];
  const SEQ = [0, 1, 0, 2, 0, 3, 0, 4];   // 主张屏每隔一屏回来一次，过道里的人随时抬头都大概率看到主张
  const PASSED = { en: "A comment was passed to the owner", zh: "一条留言已交给店主" };
  const OWN_WORDS = { en: "A visitor asked in their own words", zh: "访客用自己的话问了一个问题" };

  function mount(root, bus) {
    const cfg = () => B.config;
    let scene = 0;
    let pos = 0;
    let claimLang = 0;
    let live = null;
    let liveTimer = null;
    let liveDog = null;
    let rotTimer = null;
    let animStep = 0;
    let animTimer = null;
    let st = stats();
    const badge = B.connBadge(bus, "both");

    const both = (k) => `${esc(t("en", k))} · <span lang="zh-CN">${esc(t("zh", k))}</span>`;
    const proof = () => {
      const p = cfg().proof || {};
      const dated = !!p.asOf;
      const c = p.counts || {};
      const n = (v) => (dated ? Math.max(0, Math.floor(Number(v) || 0)) : 0);
      return { p, counts: { posts: n(c.posts), triaged: n(c.triaged), booked: n(c.booked) }, note: dated && p.relatedParty ? `${t("en", "relatedAsOf", { d: p.asOf })} · ${t("zh", "relatedAsOf", { d: p.asOf })}` : `${t("en", "soFar")} · ${t("zh", "soFar")}` };
    };
    const num = (v) => (v > 0 ? `<span class="v">${v}</span>` : `<span class="v n0">0</span>`);

    function foot() {
      const runs = Math.max(0, Math.min(9999, Math.floor(Number(st.runs)) || 0));
      const pr = proof();
      const cell = (k, v, s) => `<div><span class="k">${esc(t("en", k))}</span><span class="k zh" lang="zh-CN">${esc(t("zh", k))}</span>${v}${s ? `<span class="s">${s}</span>` : ""}</div>`;
      return `<div class="scr-foot">
        ${cell("runsToday", runs ? `<span class="v">${runs}</span>` : `<span class="v zero">${esc(t("en", "beFirst"))}</span><span class="k zh" lang="zh-CN">${esc(t("zh", "beFirst"))}</span>`, "")}
        ${cell("lastRun", st.last != null ? `<span class="v">${mmss(st.last)}</span>` : `<span class="v n0">—</span>`, both("simChannel"))}
        ${cell("realPilot", num(pr.counts.booked), esc(pr.note))}
      </div>`;
    }

    function top(right) {
      return `<div class="scr-top"><span class="mark">${MARK}</span><span class="nm">Aivora<small>${esc(t("en", "tagline"))}</small><small lang="zh-CN">${esc(t("zh", "tagline"))}</small></span><span class="grow"></span>${right}<span data-badge></span></div>`;
    }
    const dots = () => `<span class="scr-dots" aria-hidden="true">${PIN.map((_, i) => `<i class="${i === scene ? "on" : ""}"></i>`).join("")}</span>`;

    const SCENES = [
      () => {
        const L = claimLang % 2 === 0 ? "en" : "zh";
        return `<section class="scene" aria-label="Aivora · claim · 主张"><h1 class="claim" lang="${L === "zh" ? "zh-CN" : "en"}"><span class="l1">${esc(t(L, "claim1"))}</span><span class="l2"><span class="ember">${esc(t(L, "claim2"))}</span></span></h1>
          ${chainHtml({ reached: animStep + 1, now: animStep, both: true, cls: "chain bchain" })}</section>`;
      },
      () => {
        const pr = proof();
        const chains = (pr.p.chains || []).filter((ch) => ch && ch.steps && ch.steps.length);
        const body = chains.length && pr.p.consentOnFile
          ? chains.slice(0, 1).map((ch) => `<div class="big-grid"><div><h3>${esc(L10(ch.title, "en"))}</h3>${ch.steps.map((s) => `<p><span class="pv pv-m" aria-hidden="true"></span> ${esc(L10(s, "en"))}</p>`).join("")}</div><div lang="zh-CN"><h3>${esc(L10(ch.title, "zh"))}</h3>${ch.steps.map((s) => `<p class="zh">${esc(L10(s, "zh"))}</p>`).join("")}<p>${esc(t("en", "related"))}</p><p class="zh">${esc(t("zh", "related"))}</p></div></div>`).join("")
          : `<div class="big-grid"><div><h3>${esc(t("en", "proof_empty"))}</h3><p>${esc(t("en", "proof_empty_p"))}</p></div><div lang="zh-CN"><h3>${esc(t("zh", "proof_empty"))}</h3><p class="zh">${esc(t("zh", "proof_empty_p"))}</p></div></div>`;
        return `<section class="scene" aria-label="Proof · 证据"><h2 class="big-h">${esc(t("en", "proof_h"))}<small lang="zh-CN">${esc(t("zh", "proof_h"))}</small></h2>${body}
          <div class="big-grid g3">${[["c_posts", pr.counts.posts], ["c_triaged", pr.counts.triaged], ["c_booked", pr.counts.booked]].map(([k, v]) => `<div>${num(v)}<p>${esc(t("en", k))}</p><p class="zh" lang="zh-CN">${esc(t("zh", k))}</p></div>`).join("")}</div>
          <p class="scr-note">${esc(pr.note)}</p></section>`;
      },
      /* 大屏只上四条收费结构（2×2），「确认的预约」定义和定价说明放在下面；席位与导出写在结果页 */
      () => `<section class="scene" aria-label="Offer · 试点方案"><h2 class="big-h">${esc(t("en", "offer_h"))}<small lang="zh-CN">${esc(t("zh", "offer_h"))}</small></h2>
        <div class="big-grid">${[1, 3, 4, 5].map((i) => `<div><h3 class="h-md">${esc(t("en", "offer")[i])}</h3><p class="zh" lang="zh-CN">${esc(t("zh", "offer")[i])}</p></div>`).join("")}</div>
        <p class="scr-note">${esc(t("en", "offer")[2])}<br><span lang="zh-CN">${esc(t("zh", "offer")[2])}</span></p>
        <p class="scr-note">${esc(t("en", "offer_price"))} · <span lang="zh-CN">${esc(t("zh", "offer_price"))}</span></p></section>`,
      () => `<section class="scene" aria-label="Safety · 安全阀"><h2 class="big-h">${esc(t("en", "safety_h"))}<small lang="zh-CN">${esc(t("zh", "safety_h"))}</small></h2>
        <div class="big-grid g32">${t("en", "safety").map(([a, b], i) => `<div><h3 class="h-md">${icon("shield-check")} ${esc(a)}</h3><p>${esc(b)}</p><p class="zh" lang="zh-CN">${esc(t("zh", "safety")[i][0])} —— ${esc(t("zh", "safety")[i][1])}</p></div>`).join("")}</div></section>`,
      () => {
        const ch = cfg().channels || {};
        const names = (arr, L) => (arr || []).map((x) => L10(x, L)).join(L === "zh" ? "、" : " · ");
        const col = (k, arr) => {
          const en = names(arr, "en"), zh = names(arr, "zh");
          return `<div><h3 class="h-md">${esc(t("en", k))}<small lang="zh-CN">${esc(t("zh", k))}</small></h3><p>${esc(en || "—")}</p>${zh && zh !== en ? `<p class="zh" lang="zh-CN">${esc(zh)}</p>` : ""}</div>`;
        };
        return `<section class="scene" aria-label="Channels · 渠道"><h2 class="big-h">${esc(t("en", "ch_h"))}<small lang="zh-CN">${esc(t("zh", "ch_h"))}</small></h2>
        <div class="big-grid g3">${col("ch_live", ch.live)}${col("ch_pending", ch.pending)}${col("ch_roadmap", ch.roadmap)}</div>
        <p class="scr-note">${esc(t("en", "ch_note"))} · <span lang="zh-CN">${esc(t("zh", "ch_note"))}</span></p></section>`;
      },
    ];

    function animate() {
      clearInterval(animTimer);
      animStep = 0;
      if (B.reduce) { animStep = 5; return; }
      animTimer = setInterval(() => {
        animStep = animStep >= 5 ? 0 : animStep + 1;
        if (!live && scene === 0) { const el = root.querySelector(".bchain"); if (el) el.outerHTML = chainHtml({ reached: animStep + 1, now: animStep, both: true, cls: "chain bchain" }); }
      }, 2000);
    }

    function mountBadge() { const s = root.querySelector("[data-badge]"); if (s) s.appendChild(badge.el); }

    function drawAttract() {
      root.innerHTML = `<div class="scr" lang="en">${top(`<span class="scr-badge">${icon("tablet")} ${both("tryBadge")}</span>${dots()}`)}${SCENES[scene]()}${scene === 0 ? foot() : ""}</div>`;
      mountBadge();
    }

    function drawLive() {
      const d = live.draft;
      const L = d ? d.lang : "en";
      const hl = L === "zh" ? (d && d.script === "hant" ? "zh-Hant" : "zh-CN") : "en";
      const since = (x) => (x && live.tComment ? mmss((x - live.tComment) / 1000) : "");
      const reached = live.tBook ? 6 : live.tReply ? 5 : d ? 4 : live.comment ? 3 : 2;
      const now = live.tBook ? -1 : live.tReply ? 5 : d ? 4 : live.comment ? 3 : 2;
      let middle;
      if (live.tBook) {
        middle = `<div class="scene"><div class="booked num" role="status">${mmss((live.tBook - live.tComment) / 1000)}<span class="u">${both("elapsed")}<br>${both("simChannel")}</span></div>
          ${chainHtml({ reached: 6, both: true, cls: "chain bchain pre", times: { comment: "0:00", draft: since(live.tDraft), approve: since(live.tReply), booked: since(live.tBook) } })}</div>`;
      } else {
        const showCmt = d && !d.blocked;
        /* 过道大屏只显示「内置建议问题」的原话；访客自己打的字（可能含私人信息、同行广告或脏话，草稿库读不全）
           一律只显示占位，旁边照常显示 AI 草稿。转店主 / 私联的给「已交给店主」。 */
        const chips = [...t("en", "sugs"), ...t("zh", "sugs")].map((x) => x.replace("{city}", live.city || "").trim());
        const isChip = showCmt && chips.includes(String(live.comment || "").trim());
        const passed = showCmt && !isChip && d.flags && (d.flags.private || d.flags.unknown);
        const own = showCmt && !isChip && !passed;
        const flags = showCmt && d.flags ? [
          d.flags.price ? `<span class="flag hand">${icon("hand")} ${esc(t("en", "flag_price"))} · <span lang="zh-CN">${esc(t("zh", "flag_price"))}</span></span>` : "",
          d.flags.place ? `<span class="flag hand">${icon("map-pin")} ${esc(t("en", "flag_place"))} · <span lang="zh-CN">${esc(t("zh", "flag_place"))}</span></span>` : "",
          d.flags.unknown ? `<span class="flag hand">${icon("hand")} ${esc(t("en", "flag_unknown"))} · <span lang="zh-CN">${esc(t("zh", "flag_unknown"))}</span></span>` : "",
          d.flags.bot ? `<span class="flag">${icon("bot")} ${esc(t("en", "flag_bot"))} · <span lang="zh-CN">${esc(t("zh", "flag_bot"))}</span></span>` : "",
        ].join("") : "";
        const text = maskContact(live.tReply ? live.reply : showCmt ? d.text : "");
        const parts = splitDraft(text);
        const cited = showCmt && !live.tReply && d.cites && d.cites.length;
        const cmtBox = d && d.blocked
          ? `<span class="live-cmt"><span class="who">${both("step_comment")}</span>${icon("ban")} ${both("blockedOne")}</span>`
          : passed
            ? `<span class="live-cmt"><span class="who">${both("step_comment")}</span>${icon("hand")} ${esc(PASSED.en)} · <span lang="zh-CN">${esc(PASSED.zh)}</span></span>`
          : own
            ? `<span class="live-cmt"><span class="who">${both("step_comment")}</span>${icon("message-circle")} ${esc(OWN_WORDS.en)} · <span lang="zh-CN">${esc(OWN_WORDS.zh)}</span></span>`
          : showCmt
            ? `<span class="live-cmt" lang="${hl}"><span class="who">${both("step_comment")}</span>${esc(maskContact(live.comment))}</span>`
            : `<span class="live-cmt"><span class="who">${both("step_comment")}</span>${both("visitorTyping")}</span>`;
        middle = `<div class="scene" style="align-content:start">
          ${chainHtml({ reached, now, both: true, cls: "chain bchain pre", times: { comment: live.comment ? "0:00" : "", draft: since(live.tDraft), approve: since(live.tReply) } })}
          <div class="big-grid">
            <div>${cmtBox}</div>
            <div><span class="who-l">${live.tReply ? both("o_sent") : both("o_draft")}</span>
              ${text ? `<div class="live-draft" lang="${hl}">${esc(parts.body)}</div>${parts.tail ? `<div class="live-tail" lang="${hl}">${esc(parts.tail)}</div>` : ""}` : `<div class="live-draft">…</div>`}
              ${flags ? `<div class="live-flags">${flags}</div>` : ""}
              ${cited ? `<span class="who-l">${icon("info")} ${both("sampleFactsShort")}</span>` : ""}</div>
          </div></div>`;
      }
      root.innerHTML = `<div class="scr ${live.tBook ? "" : "scr-live"}">${top(`<span class="scr-badge"><span class="pulse"></span>${both("live")} · ${both("simChannel")}</span>`)}${middle}${live.tBook ? foot() : ""}</div>`;
      mountBadge();
    }

    function draw() { if (live) drawLive(); else drawAttract(); }

    function rotate() {
      clearTimeout(rotTimer);
      if (PIN.includes(location.hash.slice(1))) return;
      const k = B.reduce ? 2 : 1;
      rotTimer = setTimeout(() => {
        if (!live) {
          pos = (pos + 1) % SEQ.length;
          if (SEQ[pos] === 0) { claimLang += 1; animate(); }
          scene = SEQ[pos];
          draw();
        }
        rotate();
      }, (scene === 0 ? DWELL.claim : DWELL.other) * k);
    }
    function applyPin() {
      const i = PIN.indexOf(location.hash.slice(1));
      if (i >= 0) { clearTimeout(rotTimer); scene = i; pos = 0; claimLang = 0; if (i === 0) animate(); if (!live) draw(); }
      else rotate();
    }
    function endLive(delay) {
      clearTimeout(liveTimer); clearTimeout(liveDog);
      liveTimer = setTimeout(() => {
        live = null;
        const i = PIN.indexOf(location.hash.slice(1));
        scene = i >= 0 ? i : 0; pos = 0; claimLang = 0; animate(); draw(); applyPin();
      }, delay);
    }
    /* 访客走开、iPad 没人点：一轮最多挂 (闲置秒数 + 30) 秒 */
    const feedDog = () => { clearTimeout(liveDog); liveDog = setTimeout(() => endLive(0), ((cfg().idleSeconds || 90) + 30) * 1000); };

    bus.on((m) => {
      if (m.type === "stats") { st = adoptStats(m.stats); if (!live || live.tBook) draw(); return; }
      if (m.type === "session:start") { live = { sid: m.sid, cat: m.cat, city: m.city }; clearTimeout(liveTimer); feedDog(); draw(); return; }
      if (m.type === "state" && !live && m.sid && m.step && m.step !== "setup") {
        live = { sid: m.sid, cat: m.cat, city: m.city, comment: m.comment, tComment: m.tComment };
        if (m.comment) live.draft = B.draft({ text: m.comment, cat: m.cat, city: m.city });
        if (m.reply) { live.reply = m.reply.text; live.tReply = m.tReply; }
        if (m.step === "booked") { live.tBook = m.tBook; endLive(15000); } else feedDog();
        draw(); return;
      }
      if (!live || m.sid !== live.sid) return;
      feedDog();
      if (m.type === "comment") { live.comment = String(m.text || ""); live.tComment = m.t || Date.now(); draw(); }
      if (m.type === "draft") { live.draft = m.draft && typeof m.draft === "object" ? m.draft : null; live.tDraft = m.t || Date.now(); draw(); }
      if (m.type === "reply") { live.reply = String(m.text || ""); live.tReply = m.t || Date.now(); draw(); }
      if (m.type === "book") { live.tBook = m.t || Date.now(); draw(); endLive(15000); }
      if (m.type === "skip") endLive(4000);
      if (m.type === "reset") endLive(0);
    });
    bus.onMode((md) => { if (md === "relay-open") bus.send("state:req", {}); });
    window.addEventListener("hashchange", applyPin);

    /* 第一次点击时进全屏、保持常亮（展台大屏不会自己息屏） */
    let lock = null;
    const wake = async () => { try { if (navigator.wakeLock && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen"); } catch { /* 不支持就算了 */ } };
    document.addEventListener("click", () => { document.documentElement.requestFullscreen?.().catch(() => {}); wake(); }, { once: true });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && lock) wake(); });

    /* screen.html?fitcheck：把每一屏（含中英实时链路）在当前窗口尺寸下各渲染一次，列出被裁切的元素。
       开展前在展台大屏上开一次；无头 Chrome 可用 --dump-dom 读 #fit 的结果。 */
    async function fitCheck() {
      clearTimeout(rotTimer); clearInterval(animTimer);
      await document.fonts.ready;
      const bad = [];
      const clipped = (el) => {
        const cs = getComputedStyle(el);
        if (cs.webkitLineClamp && cs.webkitLineClamp !== "none") return false;
        return el.scrollHeight > el.clientHeight + 1 || (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1);
      };
      const scan = (name) => {
        const r = root.querySelector(".scr");
        [r, ...r.querySelectorAll(".scene, .big-grid, .big-grid > div, .scr-foot .k, .scr-foot .s, .scr-top .nm small, .scr-badge")].forEach((el) => {
          if (clipped(el)) bad.push(`${name}: ${el.className || el.tagName} (${el.scrollHeight}>${el.clientHeight} / ${el.scrollWidth}>${el.clientWidth})`);
        });
        const sb = r.getBoundingClientRect().bottom;
        r.querySelectorAll(".scene > *, .scr-foot").forEach((el) => { if (el.getBoundingClientRect().bottom > sb + 1) bad.push(`${name}: ${el.className || el.tagName} below the screen edge`); });
      };
      for (let i = 0; i < SCENES.length; i++) {
        for (const cl of i === 0 ? [0, 1] : [0]) { live = null; scene = i; claimLang = cl; animStep = 5; drawAttract(); scan(`${PIN[i]}${i === 0 ? (cl ? "-zh" : "-en") : ""}`); }
      }
      const now = Date.now();
      for (const [cat, city, text] of [["blinds", "Vaughan", t("en", "sugs")[0].replace("{city}", "Vaughan")], ["furniture", "佛山", t("zh", "sugs")[0].replace("{city}", "佛山")]]) {
        const d = B.draft({ text, cat, city });
        live = { sid: "fit", cat, city, comment: text, tComment: now - 9000, draft: d, tDraft: now - 6000 };
        drawLive(); scan(`live-${d.lang}-draft`);
        live.reply = d.text; live.tReply = now - 3000; drawLive(); scan(`live-${d.lang}-sent`);
        live.tBook = now; drawLive(); scan(`live-${d.lang}-booked`);
      }
      live = null; scene = 0; draw();
      const out = document.createElement("pre");
      out.id = "fit";
      out.textContent = `${innerWidth}x${innerHeight} ${bad.length ? "FIT FAIL" : "FIT OK"}\n${bad.join("\n")}`;
      document.body.appendChild(out);
      document.title = bad.length ? `FIT FAIL (${bad.length})` : "FIT OK";
    }

    animate(); draw();
    if (/[?&]fitcheck\b/.test(location.search)) { fitCheck(); return { draw }; }
    applyPin();
    bus.send("state:req", {});
    return { draw };
  }

  window.BoothScreen = { mount };
})();
