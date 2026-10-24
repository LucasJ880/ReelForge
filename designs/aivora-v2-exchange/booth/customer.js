/* 客户手机（iPad A）：访客先设好「自己的店」，再扮成自己的客户留言、收到回复、选时间。
   全程模拟渠道并写明；任何一步都能「重新开始」；设置之后的每一步闲置都会自动回到开头，下一位从干净的状态开始。 */
(() => {
  "use strict";
  const B = window.Booth;
  const { esc, t, icon, catOf, CATS, slots, slotLabel, mmss, shopName } = B;

  function mount(root, bus, opts = {}) {
    let lang = opts.lang || B.uiLang("customer");
    const fresh = () => ({ step: "setup", sid: null, cat: "blinds", city: "", comment: null, tComment: 0, reply: null, tReply: 0, slot: null, tBook: 0, blocked: false });
    let S = fresh();
    let idle;
    let postEl = null;      // 帖子媒体节点只建一次，重绘时挪回去，视频不会反复重载
    let postKey = "";
    const say = (msg) => { const r = opts.live || document.getElementById("sr-live"); if (r) { r.textContent = ""; requestAnimationFrame(() => (r.textContent = msg)); } };

    /* 留言之后访客人在 iPad B 前看草稿、亲手改回复，这一步只设长超时，并且店主台每有动静就续上；
       「结束本轮」和大屏看门狗兜底。 */
    const kickIdle = () => {
      clearTimeout(idle);
      if (S.step === "setup" || !S.sid) return;
      const secs = ["booked", "skipped"].includes(S.step) ? 30 : S.step === "waiting" ? 300 : (B.config.idleSeconds || 90);
      idle = setTimeout(() => reset("idle"), secs * 1000);
    };
    const toEn = () => { lang = opts.lang || "en"; B.setUiLang("customer", lang); if (opts.badge) opts.badge.setLang(lang); };

    function reset(reason) {
      if (S.sid) bus.send("reset", { sid: S.sid, src: "customer", reason: reason || "start-over" });
      S = fresh();
      toEn();
      postEl = null; postKey = "";
      draw("ph-title");
    }

    function getPost() {
      const key = `${S.cat}|${B.reduce}`;
      if (postEl && postKey === key) return postEl;
      const c = catOf(S.cat);
      const el = document.createElement("div");
      el.className = "post-media";
      if (c.media) {
        el.innerHTML = B.reduce
          ? `<img src="media/${c.poster}.jpg" alt="">`
          : `<video src="media/${c.media}.mp4" poster="media/${c.poster}.jpg" muted loop playsinline autoplay aria-hidden="true"></video>`;
      } else {
        el.innerHTML = `<div class="ph-ph">${icon(c.icon)}<span></span></div>`;
      }
      postEl = el; postKey = key;
      return el;
    }

    /* 回复里的链接文字跟回复的语言走，不跟手机界面语言走 */
    const linkify = (text) => esc(text).replace(/\[(booking link|预约链接|預約連結)\]/g, (_, k) => `<u>${esc(k === "booking link" ? t("en", "linkWord") : k === "预约链接" ? t("zh", "linkWord") : B.toHant(t("zh", "linkWord")))}</u>`);

    function draw(focusId) {
      const keep = focusId || (document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : "");
      const L = lang;
      const shop = shopName(S.cat, S.city, L);
      const top = `<div class="ph-top"><span class="mark mark-sm">${B.MARK}</span><b>${esc(S.step === "setup" ? "Aivora" : shop)}</b><span class="grow"></span><span data-badge></span><span data-lang></span></div>
        <div class="ph-sim">${esc(t(L, "simNote"))}</div>`;
      let body = "";
      let foot = "";
      if (S.step === "setup") {
        body = `<form id="ph-setup" class="ph-form">
          <h1 class="ph-h" id="ph-title" tabindex="-1">${esc(t(L, "start_h"))}</h1><p class="ph-p">${esc(t(L, "start_p"))}</p>
          <div class="ph-label" id="q-sell">${esc(t(L, "q_sell"))}</div>
          <div class="ph-grid" role="group" aria-labelledby="q-sell">${Object.entries(CATS).map(([k, c]) => `<button type="button" class="ph-opt" id="cat-${k}" data-cat="${k}" aria-pressed="${S.cat === k}">${esc(c[L])}</button>`).join("")}</div>
          <label class="ph-label" for="ph-city">${esc(t(L, "q_city"))}</label>
          <input class="ph-input" id="ph-city" autocomplete="off" enterkeyhint="go" placeholder="${esc(t(L, "city_ph"))}" value="${esc(S.city)}">
          <button type="submit" class="ph-cta" id="ph-go" ${S.city.trim() ? "" : "disabled"}>${esc(t(L, "go"))}${icon("arrow-right")}</button>
        </form>`;
      } else {
        const c = catOf(S.cat);
        const thread = [];
        if (S.comment) thread.push(`<div class="cmt"><span class="av" aria-hidden="true">${L === "zh" ? "我" : "Me"}</span><div><div class="who"><b>${esc(t(L, "you"))}</b></div><div class="bub" id="ph-mine" tabindex="-1">${esc(S.comment)}</div></div></div>`);
        if (S.step === "waiting" && !S.blocked) thread.push(`<div class="cmt"><span class="av shop" aria-hidden="true">${esc(shop.slice(0, 1))}</span><div><div class="who">${esc(t(L, "waiting"))}</div><div class="typing" role="status" aria-label="${esc(t(L, "waiting"))}"><i></i><i></i><i></i></div></div></div>`);
        if (S.step === "waiting" && S.blocked) thread.push(`<p class="ph-p" role="status">${esc(t(L, "blockedCustomer"))}</p>`);
        if (S.reply) thread.push(`<div class="cmt"><span class="av shop" aria-hidden="true">${esc(shop.slice(0, 1))}</span><div><div class="who"><b>${esc(shop)}</b></div><div class="bub" id="ph-reply" tabindex="-1">${linkify(S.reply.text)}</div></div></div>`);
        if (S.step === "skipped") thread.push(`<p class="ph-p" role="status">${esc(t(L, "noReply"))}</p>`);
        body = `<article class="post"><div data-post></div><div class="post-cap"><b>${esc(shop)}</b> · ${esc(c[L])}${c.media ? ` · <span class="ph-tag">${esc(t(L, "sampleVideo"))}</span>` : ` · ${esc(t(L, "yourVideo"))}`}</div></article>`;
        if (S.step === "ask") body += `<div><h1 class="ph-h" id="ph-title" tabindex="-1" style="font-size:22px">${esc(t(L, "ask_h"))}</h1><p class="ph-p">${esc(t(L, "ask_p"))}</p></div>
          <div class="sugs">${t(L, "sugs").map((s, i) => `<button type="button" class="sug" id="sug-${i}" data-sug="${esc(s.replace("{city}", S.city))}">${esc(s.replace("{city}", S.city))}</button>`).join("")}</div>`;
        body += `<div class="thread">${thread.join("")}</div>`;
        if (S.step === "replied") {
          body += S.reply && S.reply.link
            ? `<button type="button" class="ph-cta" id="ph-book">${icon("calendar-check")}${esc(t(L, "bookBtn"))}</button>`
            : `<button type="button" class="ph-cta" id="ph-done">${icon("check")}${esc(t(L, "done"))}</button>`;
        }
        if (S.step === "pick") {
          body += `<div class="ph-label" id="pick-h">${esc(t(L, "pick_h"))}</div><div class="slots" role="group" aria-labelledby="pick-h">${slots().map((at, i) => `<button type="button" class="slot" id="slot-${i}" data-slot="${at}" aria-pressed="${S.slot === at}"><span>${esc(slotLabel(at, L))}</span>${S.slot === at ? icon("check") : ""}</button>`).join("")}</div>
            <button type="button" class="ph-cta" id="ph-confirm" ${S.slot ? "" : "disabled"}>${esc(t(L, "confirm"))}</button>`;
        }
        if (S.step === "booked") {
          const secs = (S.tBook - S.tComment) / 1000;
          body += `<div class="done-card" role="status" tabindex="-1" id="ph-booked"><b style="font-size:22px">${esc(t(L, "booked_h"))}</b><span class="ph-p">${esc(t(L, "booked_p", { slot: slotLabel(S.slot, L), measure: c.measure[L] }))}</span><span class="ph-p">${esc(t(L, "elapsed"))} · ${esc(t(L, "simChannel"))}</span><span class="big num">${mmss(secs)}</span></div>`;
        }
        body += `<button type="button" class="ph-sec" id="ph-reset">${icon("rotate-ccw")}${esc(t(L, "startOver"))}</button>`;
        if (S.step === "ask") foot = `<form class="composer" id="ph-form"><label class="sr" for="ph-c">${esc(t(L, "ask_ph"))}</label><input class="ph-input" id="ph-c" maxlength="280" autocomplete="off" enterkeyhint="send" placeholder="${esc(t(L, "ask_ph"))}"><button class="ph-cta" type="submit" id="ph-send">${esc(t(L, "send"))}</button></form>`;
      }
      root.innerHTML = `<div class="phone" lang="${L === "zh" ? "zh-CN" : "en"}">${top}<div class="ph-body">${body}</div>${foot}</div>`;
      const slot = root.querySelector("[data-post]");
      if (slot) { const p = getPost(); slot.replaceWith(p); const v = p.querySelector("video"); if (v && v.paused) v.play().catch(() => {}); }
      root.querySelector("[data-lang]").appendChild(B.langToggle("customer", L, (l) => {
        lang = l; if (opts.badge) opts.badge.setLang(l);
        draw(); root.querySelector('[data-lang] [aria-pressed="true"]')?.focus({ preventScroll: true });
      }));
      if (opts.badge) root.querySelector("[data-badge]").appendChild(opts.badge.el);
      const f = keep && root.querySelector(`#${CSS.escape(keep)}`);
      if (f) f.focus({ preventScroll: true });
      kickIdle();
    }

    function start() {
      S.city = (root.querySelector("#ph-city")?.value || "").trim();
      if (!S.city) return;
      S.sid = Math.random().toString(36).slice(2, 10);
      S.step = "ask";
      bus.send("session:start", { sid: S.sid, cat: S.cat, city: S.city, uiLang: lang });
      draw("ph-c");
    }

    root.addEventListener("click", (e) => {
      kickIdle();
      const cat = e.target.closest("[data-cat]");
      if (cat) { S.cat = cat.dataset.cat; root.querySelectorAll("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", b === cat)); return; }
      const sug = e.target.closest("[data-sug]");
      if (sug) { const inp = root.querySelector("#ph-c"); if (inp) { inp.value = sug.dataset.sug; inp.focus(); } return; }
      if (e.target.closest("#ph-reset")) { reset("start-over"); return; }
      if (e.target.closest("#ph-done")) { reset("done"); return; }
      if (e.target.closest("#ph-book")) { S.step = "pick"; draw("slot-0"); return; }
      const slot = e.target.closest("[data-slot]");
      if (slot) { S.slot = Number(slot.dataset.slot); draw(slot.id); return; }
      if (e.target.closest("#ph-confirm") && S.slot) {
        S.tBook = Date.now(); S.step = "booked";
        bus.send("book", { sid: S.sid, slot: S.slot, t: S.tBook });
        draw("ph-booked");
        say(`${t(lang, "booked_h")} ${slotLabel(S.slot, lang)}`);
      }
    });
    root.addEventListener("input", (e) => {
      kickIdle();
      if (e.target.id === "ph-city") { S.city = e.target.value; const go = root.querySelector("#ph-go"); if (go) go.disabled = !S.city.trim(); }
    });
    root.addEventListener("submit", (e) => {
      e.preventDefault();
      if (e.target.id === "ph-setup") { start(); return; }
      if (e.target.id !== "ph-form") return;
      const v = root.querySelector("#ph-c").value.trim();
      if (!v) return;
      S.comment = v; S.tComment = Date.now(); S.step = "waiting";
      bus.send("comment", { sid: S.sid, text: v, t: S.tComment });
      draw("ph-mine");
      say(t(lang, "waiting"));
    });

    bus.on((m) => {
      if (m.type === "state:req") {
        if (S.sid && m.from !== bus.me) bus.send("state", { sid: S.sid, cat: S.cat, city: S.city, comment: S.comment, tComment: S.tComment, step: S.step, reply: S.reply, tReply: S.tReply, slot: S.slot, tBook: S.tBook });
        return;
      }
      if (!S.sid || m.sid !== S.sid) return;
      kickIdle();
      if (m.type === "draft" && S.step === "waiting" && m.draft && m.draft.blocked) { S.blocked = true; draw(); say(t(lang, "blockedCustomer")); return; }
      if (m.type === "reply") bus.send("ack", { sid: S.sid, t: m.t });
      if (m.type === "reply" && S.step === "waiting") {
        S.reply = { text: String(m.text || ""), link: m.link !== false, by: m.by }; S.tReply = m.t || Date.now(); S.step = "replied";
        draw(S.reply.link ? "ph-book" : "ph-done");
        say(`${shopName(S.cat, S.city, lang)}: ${S.reply.text}`);
      }
      if (m.type === "skip" && S.step === "waiting") { S.step = "skipped"; draw("ph-reset"); say(t(lang, "noReply")); }
      if (m.type === "reset" && m.src !== "customer") { S = fresh(); toEn(); postEl = null; postKey = ""; draw("ph-title"); }
    });

    draw();
    return { reset, get state() { return S; } };
  }

  window.BoothCustomer = { mount };
})();
