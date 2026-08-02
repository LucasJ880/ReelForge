const { useState } = React;
const D = window.AIVORA_DATA;

/* ---------- 侧边栏 ---------- */
function Sidebar({ screen, setScreen }) {
  const items = [
    { id: "client", name: "客户工作台", icon: IconHome },
    { id: "create", name: "出片工作台", icon: IconClap },
    { id: "library", name: "成片库", icon: IconGrid },
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
        </button>
      ))}
      <div className="side-foot">
        <div className="muted">Shuyu 余额</div>
        <div className="balance-num">{D.client.balance} <span style={{ fontSize: 12, color: "var(--text-3)" }}>pts</span></div>
      </div>
    </div>
  );
}

/* ---------- 客户工作台 ---------- */
function ClientScreen() {
  const doneCount = D.batch.items.filter((x) => x.status === "done").length;
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
          <span style={{ color: "var(--gold)", letterSpacing: 0 }}>{doneCount}/10 完成</span>
        </div>
        {D.batch.items.map((b) => (
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

/* ---------- 出片工作台 ---------- */
function CreateScreen({ toast }) {
  const [tpl, setTpl] = useState("roller-glare");
  return (
    <div className="page" data-screen-label="出片工作台">
      <div className="page-head">
        <div>
          <div className="page-title">出片工作台</div>
          <div className="page-desc">SunnyShutter 锁定流水线 · Image2 五帧故事版抽卡 → Fast VIP 15s</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">风格模板 · sunnyshutter-shade-cta 家族</div>
        <div className="tpl-grid">
          {D.templates.map((t) => (
            <div key={t.id} className={`tpl ${tpl === t.id ? "sel" : ""}`} onClick={() => setTpl(t.id)}>
              <div className="tpl-name">{t.name}</div>
              <div className="tpl-sub">{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">产品参考图（Visual Bible 真值）</div>
        <div className="refs">
          {D.refs.map((r) => <img key={r} src={r} alt="产品参考图" />)}
          <div className="ref-add">+</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          故事版 · 5 帧 × 4 候选抽卡
          <span style={{ letterSpacing: 0 }}>AI 评审择优 · 帧间图像锚定</span>
        </div>
        <div className="sb-frames">
          {D.storyboard.map((f) => (
            <div className="sb-frame" key={f.id}>
              <div className="sb-shot">
                <img src={f.img} alt={f.tag} />
                <span className="sb-score">{f.score}</span>
              </div>
              <div className="sb-tag">{f.tag}</div>
              <div className="sb-sub">{f.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="budget">
            <div><div className="big">≈ 13.4k</div><div className="lbl">积分 / 条（CEO 预算内）</div></div>
            <div><div className="big">5 × 4</div><div className="lbl">帧 × 抽卡候选</div></div>
            <div><div className="big">15s</div><div className="lbl">9:16 竖屏</div></div>
          </div>
          <button className="btn primary" onClick={() => toast("批次已提交 · 故事版抽卡进行中")}>提交批量出片</button>
        </div>
      </div>
    </div>
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
            <div className="field">
              <label>品牌名</label>
              <input placeholder="e.g. Maple Kitchen Co." />
            </div>
            <div className="field">
              <label>Logo（PNG 透明底）</label>
              <input type="text" placeholder="上传或粘贴 URL" />
            </div>
            <div className="field">
              <label>电话</label>
              <input placeholder="416-xxx-xxxx" />
            </div>
            <div className="field">
              <label>地址</label>
              <input placeholder="街道 · 城市 · 省份" />
            </div>
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
function LibraryScreen({ toast }) {
  const [videos, setVideos] = useState(D.library);
  const [active, setActive] = useState(null);
  const markBranded = (video) => {
    setVideos((v) => v.map((x) => (x.id === video.id ? { ...x, branded: true } : x)));
    setActive(null);
    toast(<span>已生成品牌成片 <span className="gold">{video.name.split(" ")[0]}-branded.mp4</span></span>);
  };
  return (
    <div className="page" data-screen-label="成片库">
      <div className="page-head">
        <div>
          <div className="page-title">成片库</div>
          <div className="page-desc">交付只认 branded 成片 · 原片仅作素材</div>
        </div>
      </div>
      <div className="lib-grid">
        {videos.map((v) => (
          <div className="vid-card" key={v.id}>
            <div className="vid-shot">
              <img src={v.img} alt={v.name} />
              {v.branded && <span className="vid-branded">已封装</span>}
              <span className="vid-dur">{v.branded ? "17.4s" : "15s"}</span>
            </div>
            <div className="vid-body">
              <div className="vid-name">{v.name}</div>
              <div className="vid-meta">{v.meta}</div>
              <button className="btn small block" onClick={() => setActive(v)}>
                <IconPlus style={{ width: 12, height: 12 }} /> {v.branded ? "重新封装" : "品牌封装"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {active && <BrandDrawer video={active} onClose={() => setActive(null)} onDone={markBranded} />}
    </div>
  );
}

/* ---------- App ---------- */
function App() {
  const [screen, setScreen] = useState("client");
  const [toastMsg, setToastMsg] = useState(null);
  const toast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };
  return (
    <div className="shell">
      <Sidebar screen={screen} setScreen={setScreen} />
      <div className="main">
        {screen === "client" && <ClientScreen />}
        {screen === "create" && <CreateScreen toast={toast} />}
        {screen === "library" && <LibraryScreen toast={toast} />}
      </div>
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
