/* 三块屏：工作台「今天」、创作「一句话起片」、信息架构全景。
   全部是展示型组件：props 进、回调出，不持有应用状态。 */

const Icon = ({ name, ...rest }) => {
  const C = window[name];
  return C ? <C {...rest} /> : null;
};

const Sparkline = ({ points, tone }) => {
  const w = 68, h = 20;
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i / (points.length - 1)) * w} ${h - ((p - min) / span) * h}`)
    .join(" ");
  const stroke = tone === "winning" ? "var(--good)" : tone === "losing" ? "var(--bad)" : "var(--ink-3)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - ((points[points.length - 1] - min) / span) * h} r="2.4" fill={stroke} />
    </svg>
  );
};

/* ============================ 今天 ============================ */

function ScreenToday({ dense, onGo }) {
  return (
    <div className="stack" style={{ gap: "var(--gap)" }} data-screen-label="今天">
      <div className="between" style={{ alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6 }}>
          <p className="kicker">SUNNY SHUTTERS · 多伦多</p>
          <h1 className="h1">这周还差 2 条就够节奏了</h1>
          {!dense && (
            <p className="sub">
              你设定的节奏是每周 5 条。已发 3 条、排期 2 条，周四和周六是空的。
            </p>
          )}
        </div>
        <button type="button" className="btn btn--primary" onClick={() => onGo("create")}>
          <Icon name="IcWand" />开始创作
        </button>
      </div>

      {/* 本周节奏 */}
      <div className="card">
        <div className="card__hd">
          <h2 className="h2">本周节奏</h2>
          <button type="button" className="btn btn--ghost" onClick={() => onGo("calendar")}>
            去日历<Icon name="IcArrow" />
          </button>
        </div>
        <div className="card__bd">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8 }}>
            {WEEK.map((d) => (
              <div key={d.date} className="stack"
                   style={{
                     gap: 8, padding: dense ? "8px" : "12px 10px",
                     border: "1px solid var(--line)", borderRadius: "var(--radius)",
                     background: d.posts.length === 0 ? "transparent" : "var(--panel-2)",
                     borderStyle: d.posts.length === 0 ? "dashed" : "solid",
                     minHeight: dense ? 92 : 118,
                   }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontSize: "var(--meta-size)", color: "var(--ink-2)" }}>{d.day}</span>
                  <span className="num" style={{ fontSize: "var(--meta-size)", color: "var(--ink-3)" }}>{d.date}</span>
                </div>
                {d.posts.length === 0 ? (
                  <span style={{ fontSize: "var(--meta-size)", color: "var(--ink-3)", marginTop: "auto" }}>空</span>
                ) : d.posts.map((p, i) => {
                  const km = KIND_META[p.kind], sm = STATE_META[p.state];
                  return (
                    <div key={i} className="row" style={{ gap: 6, fontSize: "var(--meta-size)" }}>
                      <span className="dot" style={{
                        background: sm.tone === "good" ? "var(--good)" : sm.tone === "warn" ? "var(--warn)" : "var(--ink-3)",
                      }} />
                      <Icon name={km.icon} style={{ width: 13, height: 13, color: "var(--ink-2)" }} />
                      <span style={{ color: "var(--ink-2)" }}>{p.ch}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: dense ? "1.1fr .9fr" : "1fr" }}>
        {/* 待决定 */}
        <div className="card">
          <div className="card__hd"><h2 className="h2">等你决定</h2><span className="num" style={{ color: "var(--ink-3)", fontSize: "var(--meta-size)" }}>3</span></div>
          <div className="stack">
            {TODOS.map((t, i) => (
              <div key={t.id} className="between"
                   style={{
                     padding: dense ? "10px 14px" : "16px",
                     borderTop: i === 0 ? "none" : "1px solid var(--line)",
                     alignItems: "flex-start", gap: 12,
                   }}>
                <div className="row" style={{ gap: 10, alignItems: "flex-start", minWidth: 0 }}>
                  <span className="dot" style={{
                    marginTop: 8,
                    background: t.tone === "warn" ? "var(--warn)" : t.tone === "good" ? "var(--good)" : "var(--ink-3)",
                  }} />
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{t.title}</span>
                    <span style={{ color: "var(--ink-2)", fontSize: "var(--meta-size)" }}>{t.body}</span>
                  </div>
                </div>
                <button type="button" className="btn" style={{ flexShrink: 0 }}>{t.cta}</button>
              </div>
            ))}
          </div>
        </div>

        {/* 赛马浓缩 —— 与平台看板的分野就在这里 */}
        <div className="card">
          <div className="card__hd">
            <div className="stack" style={{ gap: 2 }}>
              <h2 className="h2">哪个结构在赢</h2>
              {!dense && <span style={{ color: "var(--ink-3)", fontSize: "var(--meta-size)" }}>近 30 天 · 按创意配方，不是按帖子</span>}
            </div>
            <button type="button" className="btn btn--ghost" onClick={() => onGo("racing")}>
              全部<Icon name="IcArrow" />
            </button>
          </div>
          <div className="stack">
            {RECIPES.map((r, i) => (
              <div key={r.id} className="between"
                   style={{ padding: dense ? "9px 14px" : "14px 16px", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                    {r.state === "thin" && <span className="tag tag--mute">样本不足</span>}
                  </span>
                  {!dense && <span style={{ color: "var(--ink-3)", fontSize: "var(--meta-size)" }}>{r.note}</span>}
                </div>
                <div className="row" style={{ gap: 14, flexShrink: 0 }}>
                  <span className="num" style={{ color: "var(--ink-3)", fontSize: "var(--meta-size)" }}>n={r.n}</span>
                  <Sparkline points={r.trend} tone={r.state} />
                  <span className="num" style={{
                    width: 52, textAlign: "right", fontWeight: 650,
                    color: r.lift === null ? "var(--ink-3)"
                      : r.lift >= 1.5 ? "var(--good)" : r.lift < 1 ? "var(--bad)" : "var(--ink-2)",
                  }}>
                    {r.lift === null ? "—" : `${r.lift.toFixed(1)}×`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ 创作 ============================ */

function ScreenCreate({ dense }) {
  const [seed, setSeed] = React.useState(SEED);
  const [picked, setPicked] = React.useState(["o1", "o2", "o4"]);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="stack" style={{ gap: "var(--gap)" }} data-screen-label="创作">
      <div className="stack" style={{ gap: 6 }}>
        <p className="kicker">创作</p>
        <h1 className="h1">说一句话，这周的内容就有了</h1>
        {!dense && <p className="sub">也可以放一张产品图或一个商品链接。三种入口进同一条流水线。</p>}
      </div>

      {/* 输入 */}
      <div className="card">
        <div className="card__bd stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            {["一句话", "一张产品图", "商品链接"].map((t, i) => (
              <button key={t} type="button" className="chip" aria-pressed={i === 0}>{t}</button>
            ))}
          </div>
          <textarea
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            rows={dense ? 2 : 3}
            style={{
              width: "100%", resize: "vertical", padding: "12px 14px",
              background: "var(--panel-2)", color: "var(--ink)",
              border: "1px solid var(--line)", borderRadius: "var(--radius)",
              font: "inherit", fontSize: "calc(var(--body-size) + 1px)", lineHeight: 1.7,
            }}
          />
          <div className="between">
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="tag tag--mute">品牌包 SunnyShutter</span>
              <span className="tag tag--good">自然植入</span>
              <span className="tag tag--mute">一周 5 条</span>
            </div>
            <button type="button" className="btn btn--primary"><Icon name="IcWand" />产出这周内容</button>
          </div>
        </div>
      </div>

      {/* 产出 */}
      <div className="between">
        <h2 className="h2">一次产出四种形态</h2>
        <span style={{ color: "var(--ink-3)", fontSize: "var(--meta-size)" }}>
          已选 <span className="num">{picked.length}</span> / 4 进日历
        </span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: dense ? "repeat(4, minmax(0,1fr))" : "repeat(2, minmax(0,1fr))" }}>
        {OUTPUTS.map((o) => {
          const km = KIND_META[o.kind];
          const on = picked.includes(o.id);
          return (
            <div key={o.id} className="card" style={{ borderColor: on ? "var(--accent)" : "var(--line)" }}>
              <div className="card__hd">
                <span className="row" style={{ gap: 8 }}>
                  <Icon name={km.icon} style={{ width: 15, height: 15, color: "var(--accent)" }} />
                  <span style={{ fontWeight: 600 }}>{o.label}</span>
                </span>
                <span className="num" style={{ color: "var(--ink-3)", fontSize: "var(--meta-size)" }}>{o.spec}</span>
              </div>

              {/* 预览占位：真实素材由生成管线产出，这里只标出画幅与位置 */}
              <div style={{
                margin: "14px auto 0", width: "fit-content",
                aspectRatio: o.kind === "video" ? "9 / 16" : o.kind === "carousel" ? "4 / 5" : o.kind === "image" ? "1 / 1" : "3 / 2",
                maxHeight: dense ? 150 : 210,
                border: "1px dashed var(--line-strong)", borderRadius: "var(--radius)",
                background: "var(--panel-2)",
                display: "grid", placeItems: "center",
                color: "var(--ink-3)", fontSize: "var(--meta-size)",
              }}>
                {o.spec}
              </div>

              <div className="card__bd stack" style={{ gap: 10 }}>
                <div className="stack" style={{ gap: 3 }}>
                  <span style={{ fontWeight: 600 }}>{o.title}</span>
                  <span className="row" style={{ gap: 6, color: "var(--ink-3)", fontSize: "var(--meta-size)" }}>
                    <Icon name="IcSpark" style={{ width: 12, height: 12 }} />配方 · {o.recipe}
                  </span>
                </div>
                {!dense && (
                  <p className="sub" style={{ fontSize: "var(--meta-size)", color: "var(--ink-2)" }}>{o.note}</p>
                )}
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn" onClick={() => toggle(o.id)} style={{ flex: 1, justifyContent: "center" }}>
                    {on ? <><Icon name="IcCheck" />已进日历</> : "加入日历"}
                  </button>
                  <button type="button" className="btn btn--ghost">改一版</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ color: "var(--ink-3)", fontSize: "var(--meta-size)", margin: 0 }}>
        改一版不额外扣费；失败或被安全拦截的任务不计费。
      </p>
    </div>
  );
}

/* ====================== 信息架构全景 ====================== */

const FATE = {
  keep:    { label: "保留", tone: "good" },
  fold:    { label: "折进别处", tone: "mute" },
  merge:   { label: "合并", tone: "mute" },
  rebuild: { label: "按新模型重写", tone: "warn" },
  retire:  { label: "下线入口", tone: "bad" },
};

function ScreenIA({ dense }) {
  return (
    <div className="stack" style={{ gap: "var(--gap)" }} data-screen-label="信息架构">
      <div className="stack" style={{ gap: 6 }}>
        <p className="kicker">信息架构</p>
        <h1 className="h1">七个去处，每个只回答一件事</h1>
        <p className="sub">
          导航不再背着旧代运营模型。左边是新架构与归属，右边是旧入口的处置。
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: dense ? "1fr 1fr" : "1fr" }}>
        <div className="card">
          <div className="card__hd"><h2 className="h2">新架构</h2><span className="tag tag--mute">7 个顶级去处</span></div>
          <div className="scrollx">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
              <thead>
                <tr>
                  {["去处", "回答什么", "谁负责"].map((h) => (
                    <th key={h} style={{
                      textAlign: "left", padding: "9px 14px", borderBottom: "1px solid var(--line)",
                      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".12em",
                      textTransform: "uppercase", color: "var(--ink-3)", fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {IA_NEW.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontWeight: 600, whiteSpace: "nowrap" }}>{r.name}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", color: "var(--ink-2)" }}>{r.why}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                      <span className={`tag ${r.owner === "青砚" ? "tag--mute" : "tag--good"}`}>{r.owner}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card__hd"><h2 className="h2">旧入口处置</h2><span className="tag tag--warn">CEO 拍板后执行</span></div>
          <div className="stack">
            {IA_OLD.map((o, i) => {
              const f = FATE[o.fate];
              return (
                <div key={o.name} className="between"
                     style={{ padding: "11px 14px", borderTop: i === 0 ? "none" : "1px solid var(--line)", alignItems: "flex-start", gap: 12 }}>
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{o.name}</span>
                    <span style={{ color: "var(--ink-3)", fontSize: "var(--meta-size)" }}>{o.note}</span>
                  </div>
                  <span className={`tag tag--${f.tone}`} style={{ flexShrink: 0 }}>{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__bd stack" style={{ gap: 8 }}>
          <h2 className="h2">执行顺序（不允许跳级）</h2>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", color: "var(--ink-2)" }}>
            {["A 下线旧入口", "新架构 + 设计稿定稿", "按新架构实现界面", "B/C 清理旧代码"].map((s, i, arr) => (
              <React.Fragment key={s}>
                <span className="row" style={{ gap: 8 }}>
                  <span className="num" style={{
                    width: 20, height: 20, borderRadius: 999, background: "var(--accent-wash)",
                    color: "var(--accent)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                  }}>{i + 1}</span>
                  {s}
                </span>
                {i < arr.length - 1 && <Icon name="IcArrow" style={{ width: 14, height: 14, color: "var(--ink-3)" }} />}
              </React.Fragment>
            ))}
          </div>
          <p className="sub" style={{ fontSize: "var(--meta-size)" }}>
            先删入口、后删代码，中间夹着新界面上线——任何一步出问题都能退回去。数据只归档不物理删除。
          </p>
        </div>
      </div>
    </div>
  );
}

/* 其余去处在本稿中只给占位，避免填充内容 */
function ScreenStub({ id }) {
  const meta = { calendar: "日历", library: "素材库", intel: "同行灵感", racing: "战绩", brand: "品牌包" };
  return (
    <div className="stack" style={{ gap: 10, padding: "48px 0" }} data-screen-label={meta[id]}>
      <p className="kicker">{meta[id]}</p>
      <h1 className="h1">本稿未展开</h1>
      <p className="sub">
        这轮只把「今天」与「创作」做到高保真。此处的架构定位见「信息架构全景」，
        需要哪一屏展开随时说。
      </p>
    </div>
  );
}

Object.assign(window, { ScreenToday, ScreenCreate, ScreenIA, ScreenStub, Icon, Sparkline });
