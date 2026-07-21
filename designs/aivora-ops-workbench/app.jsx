const { useState, useEffect, useRef } = React;
const D = window.AIVORA_DATA;
const FAM = { shutter: "百叶", shade: "帘" };
const PTS_PER_CLIP = 13400;
const SCREEN_NAMES = { client: "客户工作台", create: "出片工作台", library: "成片库" };

/* ---------- 顶栏：工作台徽标 + 积分簇 + 帮助 + 就绪用户（参考 SY Studio） ---------- */
function Topbar({ screenName, balance, spent, delta, onHelp }) {
  const [popOpen, setPopOpen] = useState(false);
  return (
    <div className="topbar">
      <span className="top-chip">{screenName}</span>
      <span className="ver">Aivora Ops · {D.user.version}</span>
      <div className="spacer"></div>
      <div className="bal-wrap">
        <button type="button" className="top-balance" onClick={() => setPopOpen(!popOpen)}>
          <b>{balance.toLocaleString()}</b><span>pts · Shuyu</span>
          {delta && <span className="bal-delta" key={delta.key}>−{(delta.v / 1000).toFixed(1)}k</span>}
        </button>
        {popOpen && (
          <>
            <div className="pop-mask" onClick={() => setPopOpen(false)}></div>
            <div className="bal-pop">
              <div className="bp-row head"><span>今日消耗</span><span className="pts">{spent.toLocaleString()} pts</span></div>
              <div className="bp-row">
                <span><span className="dot on"></span>图 · Gemini 3 Pro 2K <span className="dim">首选</span></span>
                <span className="pts">48 pts/图</span>
              </div>
              <div className="bp-row">
                <span><span className="dot on"></span>视频 · Fast VIP <span className="dim">首选</span></span>
                <span className="pts">88 pts/s</span>
              </div>
              <div className="bp-foot">统一接入 · GET /prices 实时同步 · 兜底线路 2 条备用</div>
            </div>
          </>
        )}
      </div>
      <button type="button" className="top-help" onClick={onHelp} title="新手指引">?</button>
      <div className="top-user">
        <span className="ready"><i></i>就绪</span>
        <div className="avatar">{D.user.name[0]}</div>
        <div>
          <div className="u-name">{D.user.name}</div>
          <div className="u-mail">{D.user.mail}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 侧边栏 ---------- */
function Sidebar({ screen, setScreen, libCount }) {
  const items = [
    { id: "client", name: "客户工作台", icon: IconHome },
    { id: "create", name: "出片工作台", icon: IconClap },
    { id: "library", name: "成片库", icon: IconGrid, count: libCount },
  ];
  return (
    <div className="side">
      <div className="brand">
        <span className="brand-name">Aivora</span>
        <span className="brand-dot"></span>
        <span className="brand-sub">Ops</span>
      </div>
      <div className="nav-label">运营</div>
      {items.map((it) => (
        <button key={it.id} type="button"
             className={`nav-item ${screen === it.id ? "active" : ""}`}
             onClick={() => setScreen(it.id)}>
          <it.icon /> {it.name}
          {it.count != null && <span className="nav-count">{it.count}</span>}
        </button>
      ))}
      <div className="side-foot">
        <div className="muted">当前客户</div>
        <div style={{ fontSize: 13 }}>SunnyShutter <span style={{ color: "var(--text-3)", fontSize: 11 }}>· 锁定</span></div>
      </div>
    </div>
  );
}

/* ---------- 新手引导弹层（3 步，参考 SY Studio 首启引导） ---------- */
function Onboarding({ keepHints, setKeepHints, onSkip, onStart }) {
  const steps = [
    { t: "选产品线，勾 1–4 张参考图", s: "参考图是 Visual Bible 真值；多角度参考让窗型更稳。" },
    { t: "选一个风格模板", s: "线路、模型、质量硬闸已按 SunnyShutter 档案锁好，新手不用碰参数。" },
    { t: "单条或批量，直接提交", s: "5 帧抽卡 + AI 评审自动择优；品牌封装默认开启，成片自动进成片库。" },
  ];
  return (
    <div className="ob-mask">
      <div className="ob" data-screen-label="新手引导弹层">
        <span className="ob-badge">第一次使用 · 出片工作台</span>
        <h2>3 步出第一条成片</h2>
        <div className="ob-sub">系统已替你锁好推荐值，先跑通主流程；进阶配置都在客户工作台。</div>
        {steps.map((s, i) => (
          <div className="ob-step" key={i}>
            <span className="n">{i + 1}</span>
            <div>
              <div className="t">{s.t}</div>
              <div className="s">{s.s}</div>
            </div>
          </div>
        ))}
        <div className="ob-note">
          <b>混合批次也支持：</b>配好一批点「加入队列」，再配下一批，一次可提交 1 条百叶 + 5 条帘。
        </div>
        <div className="ob-foot">
          <span className="ob-check" onClick={() => setKeepHints(!keepHints)}>
            <span className={`cb ${keepHints ? "on" : ""}`}>✓</span> 在页面保留简短的新手提示
          </span>
          <div className="spacer"></div>
          <button className="btn" onClick={onSkip}>跳过</button>
          <button className="btn primary" onClick={onStart}>开始出片</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 客户工作台 ---------- */
function ClientScreen({ batchItems }) {
  const doneCount = batchItems.filter((x) => x.status === "done").length;
  return (
    <div className="page" data-screen-label="客户工作台">
      <div className="page-head">
        <div>
          <div className="page-title">客户工作台</div>
          <div className="page-desc">以客户为基准的锁死配置 · 风格 / 线路 / 品牌全部随客户档案生效</div>
        </div>
        <button className="btn">切换客户</button>
      </div>

      <div className="card">
        <div className="client-hero">
          <div className="client-logo"><img src={D.client.logo} alt="SunnyShutter logo" /></div>
          <div style={{ flex: 1 }}>
            <div className="client-name">{D.client.name}</div>
            <div className="client-meta">
              <span>{D.client.location}</span>
              <span>{D.client.phone}</span>
              <span>{D.client.address}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span className="chip gold"><IconLock style={{ width: 11, height: 11 }} /> 品牌封装默认开</span>
            <span className="chip green">英文硬广风格锁</span>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title">质量硬闸（全部启用）</div>
          {D.locks.map((l) => (
            <div className="lock-row" key={l.name}>
              <IconCheck />
              <div>
                <div className="lock-name">{l.name}</div>
                <div className="lock-why">{l.why}</div>
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="card">
            <div className="card-title">图片线路 <span style={{ letterSpacing: 0 }}>GET /prices 实时</span></div>
            {D.imageLanes.map((l) => (
              <div className="lane" key={l.id}>
                <span><span className={`dot ${l.on ? "on" : "off"}`}></span>{l.name} <span className="dim">{l.res}{l.primary ? " · 首选" : ""}</span></span>
                <span className="pts">{l.pts} pts</span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">视频线路</div>
            {D.videoLanes.map((l) => (
              <div className="lane" key={l.id}>
                <span><span className={`dot ${l.on ? "on" : "off"}`}></span>{l.name}{l.primary ? <span className="dim"> · 首选</span> : null}</span>
                <span className="pts">{l.pts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">
          进行中批次 · {D.batch.label}
          <span style={{ color: "var(--gold)", letterSpacing: 0 }}>{doneCount}/{batchItems.length} 完成</span>
        </div>
        {batchItems.map((b) => (
          <div className="batch-row" key={b.i}>
            <span className="idx">{String(b.i).padStart(2, "0")}</span>
            <span>{b.name}</span>
            <span className="dim" style={{ color: "var(--text-3)", fontSize: 12 }}>{b.plan}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{b.judge}</span>
            <span className={`status ${b.status}`}>
              {b.status === "done" ? "已出片" : b.status === "run" ? "生成中" : b.status === "fail" ? "失败" : "排队"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 出片工作台：步骤条 + 三步卡 + 混合队列 ---------- */
function CreateScreen({ onSubmit, guideOn, setGuideOn, openGuide, queue, setQueue, gotoClient }) {
  const [kind, setKind] = useState("shutter");
  const [picked, setPicked] = useState([0, 1]);
  const [tpl, setTpl] = useState(null);
  const [mode, setMode] = useState("single");
  const [count, setCount] = useState(5);
  const [brandOn, setBrandOn] = useState(true);

  const tpls = D.templates[kind];
  const ready = picked.length > 0 && !!tpl;
  const n = mode === "single" ? 1 : count;

  const queueCount = queue.reduce((s, q) => s + q.names.length, 0);
  const total = queueCount + (ready ? n : 0);
  const budget = ((PTS_PER_CLIP * total) / 1000).toFixed(1);

  const togglePick = (i) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));

  const currentNames = () => {
    const idx = tpls.findIndex((x) => x.id === tpl);
    return Array.from({ length: n }, (_, i) => tpls[(idx + i) % tpls.length].name);
  };

  const addToQueue = () => {
    const t = tpls.find((x) => x.id === tpl);
    setQueue((q) => [...q, {
      id: `q-${Date.now()}`,
      kind, brand: brandOn,
      label: n === 1 ? t.name : `${t.name} 起轮转`,
      names: currentNames(),
    }]);
    setTpl(null);
  };

  const fillDemo = () => {
    setQueue([
      { id: "demo-shutter", kind: "shutter", brand: true, label: D.templates.shutter[1].name, names: [D.templates.shutter[1].name] },
      { id: "demo-shade", kind: "shade", brand: true, label: "帘系轮转", names: D.templates.shade.slice(0, 5).map((t) => t.name) },
    ]);
  };

  const submit = () => {
    const groups = [...queue];
    if (ready) {
      groups.push({ id: "cur", kind, brand: brandOn, label: "当前配置", names: currentNames() });
    }
    setQueue([]);
    onSubmit(groups);
  };

  const goStep = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const stepDone = [picked.length > 0, !!tpl, ready];
  const activeIdx = stepDone.findIndex((d) => !d);
  const steps = [
    { id: "step-1", name: "产品线与参考图" },
    { id: "step-2", name: "风格模板" },
    { id: "step-3", name: "方式与品牌封装" },
    { id: "step-4", name: "提交出片" },
  ];

  return (
    <div className="page" data-screen-label="出片工作台">
      <div className="page-head">
        <div>
          <div className="page-title">出片工作台</div>
          <div className="page-desc">SunnyShutter 锁定流水线 · Image2 五帧故事版抽卡 → Fast VIP 15s</div>
        </div>
      </div>

      {guideOn && (
        <div className="guide">
          <span className="g-badge">?</span>
          <span className="g-text"><b>先做什么：</b>① 选产品线和参考图 → ② 选风格模板 → ③ 单条/批量，可「加入队列」混合两条产品线一次提交。品牌封装默认开启，成片自动进成片库。</span>
          <span className="g-btns">
            <button onClick={openGuide}>查看指引</button>
            <button onClick={() => setGuideOn(false)}>隐藏提示</button>
          </span>
        </div>
      )}

      <div className="stepper">
        {steps.map((s, i) => (
          <button key={s.id} type="button"
            className={`stp ${i < 3 && stepDone[i] ? "done" : ""} ${i === (activeIdx === -1 ? 3 : activeIdx) ? "active" : ""}`}
            onClick={() => goStep(s.id)}>
            <span className="stp-n">{i < 3 && stepDone[i] ? "✓" : i + 1}</span>{s.name}
          </button>
        ))}
      </div>

      <div className={`card ${picked.length > 0 ? "step-done" : ""}`} id="step-1">
        <div className="step-head">
          <span className="step-num">1</span>
          <span className="step-name">产品线与参考图</span>
          <span className="step-req">参考图为 Visual Bible 真值 · 至少 1 张</span>
          {picked.length > 0 && <span className="step-done-mark">✓ 已选 {picked.length} 张</span>}
        </div>
        <div className="kind-tabs">
          <button className={`kind-tab ${kind === "shutter" ? "on" : ""}`} onClick={() => { setKind("shutter"); setTpl(null); }}>百叶 Shutters</button>
          <button className={`kind-tab ${kind === "shade" ? "on" : ""}`} onClick={() => { setKind("shade"); setTpl(null); }}>帘 Shades / Curtains</button>
        </div>
        <div className="refs">
          {D.refs.map((r, i) => (
            <div key={r} className={`pick ${picked.includes(i) ? "sel" : ""}`} onClick={() => togglePick(i)}>
              <img src={r} alt={`产品参考图 ${i + 1}`} />
              <span className="tick">✓</span>
            </div>
          ))}
          <div className="ref-add">+</div>
        </div>
      </div>

      <div className={`card ${tpl ? "step-done" : ""}`} id="step-2">
        <div className="step-head">
          <span className="step-num">2</span>
          <span className="step-name">风格模板</span>
          <span className="step-req">{kind === "shutter" ? "sunnyshutter-commerce-cta 家族" : "sunnyshutter-shade-cta 家族"}</span>
          {tpl && <span className="step-done-mark">✓ 已选</span>}
        </div>
        <div className="tpl-grid">
          {tpls.map((t) => (
            <div key={t.id} className={`tpl ${tpl === t.id ? "sel" : ""}`} onClick={() => setTpl(t.id)}>
              <div className="tpl-name">{t.name}</div>
              <div className="tpl-sub">{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={`card ${ready ? "step-done" : ""}`} id="step-3">
        <div className="step-head">
          <span className="step-num">3</span>
          <span className="step-name">生成方式与品牌封装</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 18 }}>
          <div className="kind-tabs" style={{ marginBottom: 0 }}>
            <button className={`kind-tab ${mode === "single" ? "on" : ""}`} onClick={() => setMode("single")}>单条成片</button>
            <button className={`kind-tab ${mode === "batch" ? "on" : ""}`} onClick={() => setMode("batch")}>批量成片</button>
          </div>
          {mode === "batch" && (
            <span className="count-step">
              <button onClick={() => setCount((c) => Math.max(2, c - 1))}>−</button>
              <b>{count}</b>
              <button onClick={() => setCount((c) => Math.min(10, c + 1))}>+</button>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>条 · 从所选模板起族内轮转</span>
            </span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
            <span style={{ fontSize: 13 }}>品牌封装（logo + 名片尾卡）</span>
            <div className={`switch ${brandOn ? "on" : ""}`} onClick={() => setBrandOn(!brandOn)}></div>
          </div>
        </div>
        {brandOn && (
          <>
            <div className="structure sm">
              <div className="st-main">干净原片 ≈14.2s</div>
              <div className="st-trim">裁 0.8s</div>
              <div className="st-end">尾卡 3s</div>
            </div>
            <div className="st-note">左上角 logo 水印全程叠加 · 电话地址后期精确烧录，永不交给模型写字</div>
          </>
        )}
        <div className="lane-strip">
          <span><span className="dot on"></span>Image2 · Gemini 3 Pro 2K · 48 pts/图</span>
          <span><span className="dot on"></span>Seedance Fast VIP · 88 pts/s</span>
          <span><IconCheck /> 质量硬闸 5 项全开</span>
          <button className="link-btn" onClick={gotoClient}>查看硬闸与线路 →</button>
        </div>
      </div>

      <div className="submit-bar" id="step-4">
        <div className="sb-left">
          <div className="queue-row">
            {queue.map((q) => (
              <span className="q-chip" key={q.id}>
                <span className="fam">{FAM[q.kind]}</span>
                {q.label.replace(`${FAM[q.kind]} · `, "")}{q.names.length > 1 ? ` ×${q.names.length}` : ""}
                <span className="x" onClick={() => setQueue((qs) => qs.filter((x) => x.id !== q.id))}>✕</span>
              </span>
            ))}
            {ready && <span className="q-chip cur"><span className="fam">{FAM[kind]}</span>当前配置 ×{n}</span>}
            {queue.length === 0 && (
              <button className="link-btn" onClick={fillDemo}>一键示例 · 1 条百叶 + 5 条帘</button>
            )}
          </div>
          {total > 0
            ? <div className="budget-line">≈<b>{budget}k</b>pts · {total} 条 · 每条 5 帧 × 4 抽</div>
            : <div className="budget-line">队列为空 · 每条 5 帧 × 4 抽择优</div>}
        </div>
        <div className="sb-right">
          {total === 0 && <span className="submit-hint">选参考图与模板，或点左侧示例组合</span>}
          <button className="btn" disabled={!ready} onClick={addToQueue}>加入队列</button>
          <button className="btn primary" disabled={total === 0} onClick={submit}>
            {queueCount > 0 ? `提交队列 · ${total} 条` : mode === "single" ? "生成 1 条成片" : `批量生成 ${count} 条`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 生成进度：抽卡 → 评审 → 渲染 → 封装 → 入库 ---------- */
function GenerationOverlay({ items, meta, onMinimize }) {
  const doneCount = items.filter((i) => i.stage >= 4).length;
  const activeIdx = [];
  items.forEach((it, i) => { if (it.stage < 4 && activeIdx.length < 2) activeIdx.push(i); });
  return (
    <div className="gen-mask">
      <div className="gen-panel" data-screen-label="生成进度">
        <div className="gen-head">
          <div>
            <h3>出片批次 × {items.length}</h3>
            <div className="g-sub">{meta} · 已完成 {doneCount}/{items.length}</div>
          </div>
          <button className="btn small" onClick={onMinimize}>转后台</button>
        </div>
        {items.map((it, idx) => (
          <div className="gen-item" key={idx}>
            <div className="gi-head">
              <span><span className="gi-fam">{it.family}</span>{String(idx + 1).padStart(2, "0")} · {it.name}</span>
              <span className="gi-track">
                {["抽卡", "评审", "渲染", "封装"].map((s, si) => (
                  <span key={s} className={`tk ${it.stage > si ? "done" : it.stage === si && activeIdx.includes(idx) ? "on" : ""}`}>
                    {it.stage > si ? `✓ ${s}` : s}
                  </span>
                ))}
                {it.stage >= 4 && <span className="tk fin">✓ 入库</span>}
              </span>
            </div>
            <div className="gen-frames">
              {[0, 1, 2, 3, 4].map((f) => (
                <div className="gf" key={f}>
                  {f < it.frames ? (
                    <>
                      <img src={D.storyboard[f].img} alt={D.storyboard[f].tag} />
                      <span className="gf-score">{D.storyboard[f].score}</span>
                    </>
                  ) : f === it.frames && it.stage === 0 && activeIdx.includes(idx) ? (
                    <div className="roll">
                      {D.thumbPool.map((src, ci) => (
                        <img key={ci} src={src} alt="" style={{ animationDelay: `${ci * 0.22}s` }} />
                      ))}
                      <span className="roll-tag">抽卡 ×4</span>
                    </div>
                  ) : (
                    <span className="gf-idle">{D.storyboard[f].tag}</span>
                  )}
                </div>
              ))}
            </div>
            {it.stage === 1 && <div className="gi-judge">AI 评审中 · 帧间图像锚定一致性检查…</div>}
            {it.stage >= 2 && it.stage < 4 && (
              <>
                <div className="gi-judge ok">✓ 评审 8.5 分 · 选卡 #2 · 窗主角锁 / 防幻视锁通过</div>
                <div className="gen-bar"><div style={{ width: `${it.pct}%` }}></div></div>
              </>
            )}
            {it.stage >= 4 && (
              <div className="gi-judge ok">✓ 评审 8.5 分 · 裁尾 0.8s 杀假名片 · {it.brand ? "品牌封装完成" : "原片入库（未封装）"}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenPill({ items, onOpen }) {
  const done = items.filter((i) => i.stage >= 4).length;
  return (
    <button type="button" className="gen-pill" onClick={onOpen}>
      <span className="spin"></span>
      批次生成中 · {done}/{items.length}
      <span className="dim">点开查看</span>
    </button>
  );
}

/* ---------- 品牌封装抽屉 ---------- */
function BrandDrawer({ video, onClose, onDone }) {
  const [mode, setMode] = useState("sunnyshutter");
  const [logoOn, setLogoOn] = useState(true);
  const [endOn, setEndOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    setTimeout(() => { setBusy(false); onDone(video); }, 1400);
  };
  return (
    <>
      <div className="drawer-mask" onClick={onClose}></div>
      <div className="drawer" data-screen-label="品牌封装抽屉">
        <h3>品牌封装</h3>
        <div className="sub">{video.name} · 自动裁掉模型假尾卡后拼接，可选项按视频粒度生效</div>
        <div className="seg">
          <button className={mode === "sunnyshutter" ? "on" : ""} onClick={() => setMode("sunnyshutter")}>SunnyShutter（锁定）</button>
          <button className={mode === "custom" ? "on" : ""} onClick={() => setMode("custom")}>自定义客户</button>
        </div>
        <div className="toggle-row">
          <div>
            <div className="t-name">左上角 Logo 水印</div>
            <div className="t-sub">全程叠加 · SunnyShutter 锁定左上角</div>
          </div>
          <div className={`switch ${logoOn ? "on" : ""}`} onClick={() => setLogoOn(!logoOn)}></div>
        </div>
        <div className="toggle-row">
          <div>
            <div className="t-name">名片尾卡 · 3s</div>
            <div className="t-sub">精确烧录电话 / 地址，永不交给模型写字</div>
          </div>
          <div className={`switch ${endOn ? "on" : ""}`} onClick={() => setEndOn(!endOn)}></div>
        </div>
        {mode === "sunnyshutter" && endOn && (
          <div className="endcard-preview">
            <img src={D.client.endCard} alt="SunnyShutter 尾卡" />
            <div className="ec-lines">
              <b>{D.client.name}</b><br />
              {D.client.phone}<br />
              {D.client.address}, Scarborough, ON
            </div>
          </div>
        )}
        {mode === "custom" && (
          <div>
            <div className="field"><label>品牌名</label><input placeholder="e.g. Maple Kitchen Co." /></div>
            <div className="field"><label>Logo（PNG 透明底）</label><input type="text" placeholder="上传或粘贴 URL" /></div>
            <div className="field"><label>电话</label><input placeholder="416-xxx-xxxx" /></div>
            <div className="field"><label>地址</label><input placeholder="街道 · 城市 · 省份" /></div>
            <div className="t-sub" style={{ marginTop: 10 }}>尾卡底图将由 Image2 自动生成，文字后期精确烧录。</div>
          </div>
        )}
        <div className="structure">
          <div className="st-main">干净原片 {endOn || logoOn ? "≈14.2s" : "15s"}</div>
          <div className="st-trim">裁 0.8s</div>
          {endOn && <div className="st-end">尾卡 3s</div>}
        </div>
        <div className="st-note">成片结构预览 · 假名片幻觉永不流向客户</div>
        <button className="btn primary block" disabled={busy} onClick={run}>
          {busy ? "自动剪辑中…" : "＋ 自动剪辑并返回成片"}
        </button>
      </div>
    </>
  );
}

/* ---------- 成片库 ---------- */
function LibraryScreen({ videos, setVideos, toast }) {
  const [active, setActive] = useState(null);
  const [filt, setFilt] = useState("all");
  const brandedN = videos.filter((v) => v.branded).length;
  const shown = videos.filter((v) =>
    filt === "all" ? true : filt === "branded" ? v.branded : !v.branded);
  const markBranded = (video) => {
    setVideos((v) => v.map((x) => (x.id === video.id ? { ...x, branded: true } : x)));
    setActive(null);
    toast(<span>已生成品牌成片 <span className="gold">{video.id}-branded.mp4</span></span>);
  };
  const download = (v) =>
    toast(<span>已导出 <span className="gold">{v.id}-branded.mp4</span> · 1080×1920 · 交付规范通过</span>);
  return (
    <div className="page" data-screen-label="成片库">
      <div className="page-head">
        <div>
          <div className="page-title">成片库</div>
          <div className="page-desc">交付只认 branded 成片 · 原片仅作素材</div>
        </div>
      </div>
      <div className="kind-tabs lib-tabs">
        <button className={`kind-tab ${filt === "all" ? "on" : ""}`} onClick={() => setFilt("all")}>全部 {videos.length}</button>
        <button className={`kind-tab ${filt === "branded" ? "on" : ""}`} onClick={() => setFilt("branded")}>已封装 {brandedN}</button>
        <button className={`kind-tab ${filt === "raw" ? "on" : ""}`} onClick={() => setFilt("raw")}>原片素材 {videos.length - brandedN}</button>
      </div>
      {shown.length === 0 && <div className="lib-empty">此分类暂无成片</div>}
      <div className="lib-grid">
        {shown.map((v) => (
          <div className={`vid-card ${v.isNew ? "new" : ""}`} key={v.id}>
            <div className="vid-shot">
              <img src={v.img} alt={v.name} />
              {v.branded && <span className="vid-branded">已封装</span>}
              <span className="vid-dur">{v.branded ? "17.4s" : "15s"}</span>
            </div>
            <div className="vid-body">
              <div className="vid-name">{v.name}</div>
              <div className="vid-meta">{v.meta}</div>
              <div className="vid-actions">
                {v.branded ? (
                  <>
                    <button className="btn small primary grow" onClick={() => download(v)}>下载交付</button>
                    <button className="btn small" onClick={() => setActive(v)}>重封装</button>
                  </>
                ) : (
                  <button className="btn small block" onClick={() => setActive(v)}>
                    <IconPlus style={{ width: 12, height: 12 }} /> 品牌封装
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {active && <BrandDrawer video={active} onClose={() => setActive(null)} onDone={markBranded} />}
    </div>
  );
}

/* ---------- App ---------- */
let GEN_SEQ = 100;
function App() {
  const [screen, setScreen] = useState("create");
  const [videos, setVideos] = useState(D.library);
  const [balance, setBalance] = useState(151336);
  const [spent, setSpent] = useState(38200);
  const [delta, setDelta] = useState(null);
  const [queue, setQueue] = useState([]);
  const [job, setJob] = useState(null);
  const [genItems, setGenItems] = useState([]);
  const [genMin, setGenMin] = useState(false);
  const [ob, setOb] = useState(true);
  const [guideOn, setGuideOn] = useState(true);
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);
  const toast = (msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3600);
  };

  /* 流水线模拟：并发 2，贴近真实批次节奏 */
  useEffect(() => {
    if (!job) return;
    const timer = setInterval(() => {
      setGenItems((prev) => {
        const next = prev.map((x) => ({ ...x }));
        let adv = 0;
        for (const it of next) {
          if (it.stage >= 4) continue;
          if (adv >= 2) break;
          if (it.stage === 0) { it.frames += 1; if (it.frames >= 5) it.stage = 1; }
          else if (it.stage === 1) it.stage = 2;
          else if (it.stage === 2) { it.pct = Math.min(100, it.pct + 50); if (it.pct >= 100) it.stage = 3; }
          else if (it.stage === 3) it.stage = 4;
          adv += 1;
        }
        return next;
      });
    }, 380);
    return () => clearInterval(timer);
  }, [job]);

  const finishJob = () => {
    const items = genItems;
    setJob(null);
    setGenItems([]);
    setGenMin(false);
    setVideos((v) => [
      ...items.map((it, i) => ({
        id: `gen-${GEN_SEQ + i}`,
        name: `${it.name} #${GEN_SEQ + i}`,
        meta: "15s · Fast VIP · 刚刚",
        img: D.thumbPool[i % D.thumbPool.length],
        branded: it.brand,
        isNew: true,
      })),
      ...v.map((x) => ({ ...x, isNew: false })),
    ]);
    GEN_SEQ += items.length;
    const cost = PTS_PER_CLIP * items.length;
    setBalance((b) => b - cost);
    setSpent((s) => s + cost);
    setDelta({ v: cost, key: Date.now() });
    setScreen("library");
    toast(<span><span className="gold">{items.length} 条成片</span>已完成{items.every((i) => i.brand) ? "并自动品牌封装" : ""} · 已进入成片库</span>);
  };

  useEffect(() => {
    if (job && genItems.length > 0 && genItems.every((i) => i.stage >= 4)) {
      const t = setTimeout(finishJob, 800);
      return () => clearTimeout(t);
    }
  }, [genItems, job]);

  useEffect(() => {
    if (!delta) return;
    const t = setTimeout(() => setDelta(null), 2600);
    return () => clearTimeout(t);
  }, [delta]);

  const submitJob = (groups) => {
    if (groups.length === 0) return;
    const items = groups.flatMap((g) =>
      g.names.map((name) => ({ name, family: FAM[g.kind], brand: g.brand, stage: 0, frames: 0, pct: 0 }))
    );
    const famSummary = groups.map((g) => `${FAM[g.kind]} ×${g.names.length}`).join(" + ");
    const brandNote = groups.every((g) => g.brand) ? "品牌封装开" : "品牌封装部分开";
    setJob({ meta: `${famSummary} · 15s · 9:16 · ${brandNote} · ≈${((PTS_PER_CLIP * items.length) / 1000).toFixed(1)}k pts` });
    setGenItems(items);
    setGenMin(false);
  };

  return (
    <div className="shell">
      <Sidebar screen={screen} setScreen={setScreen} libCount={videos.length} />
      <div className="main">
        <Topbar screenName={SCREEN_NAMES[screen]} balance={balance} spent={spent} delta={delta} onHelp={() => setOb(true)} />
        {screen === "client" && <ClientScreen batchItems={D.batch.items} />}
        {screen === "create" && (
          <CreateScreen onSubmit={submitJob} guideOn={guideOn} setGuideOn={setGuideOn} openGuide={() => setOb(true)}
            queue={queue} setQueue={setQueue} gotoClient={() => setScreen("client")} />
        )}
        {screen === "library" && <LibraryScreen videos={videos} setVideos={setVideos} toast={toast} />}
      </div>
      {job && !genMin && <GenerationOverlay items={genItems} meta={job.meta} onMinimize={() => setGenMin(true)} />}
      {job && genMin && <GenPill items={genItems} onOpen={() => setGenMin(false)} />}
      {ob && (
        <Onboarding keepHints={guideOn} setKeepHints={setGuideOn}
          onSkip={() => setOb(false)}
          onStart={() => { setOb(false); setScreen("create"); }} />
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
