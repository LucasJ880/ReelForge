/* v2 屏幕。差异靠 CSS 承担，这里只多两个结构装置：
   - 剪辑台：一周时间线轨道（Track）
   - 店主本子：便签（sticky）
   其余保持同一套信息架构。 */

const Icon2 = ({ name, ...rest }) => {
  const C = window[name];
  return C ? <C {...rest} /> : null;
};

/* 场记板式镜号：R1·T14 */
const slugOf = (recipeId, n) => `${recipeId.toUpperCase()}·T${String(n).padStart(2, "0")}`;

const Spark2 = ({ points, tone }) => {
  const w = 72, h = 22;
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1;
  const d = points.map((p, i) =>
    `${i === 0 ? "M" : "L"}${(i / (points.length - 1)) * w} ${h - ((p - min) / span) * h}`).join(" ");
  const c = tone === "winning" ? "var(--good)" : tone === "losing" ? "var(--bad)" : "var(--ink-3)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - ((points.at(-1) - min) / span) * h} r="2.3" fill={c} />
    </svg>
  );
};

/* ══════════════ 一周时间线轨道（剪辑台招牌件） ══════════════ */
function WeekTrack() {
  return (
    <div className="track">
      {/* 播放头落在周三（今天） */}
      <div className="playhead" style={{ left: "calc(100% / 7 * 2.55)" }} aria-hidden="true" />
      <div className="track__ruler">
        {WEEK.map((d) => (
          <div className="track__tick" key={d.date}>
            <span>{d.day.replace("周", "")}</span>
            <span className="num">{d.date}</span>
          </div>
        ))}
      </div>
      <div className="track__lanes">
        {WEEK.map((d) => (
          <div className={`track__lane${d.posts.length ? "" : " track__lane--empty"}`} key={d.date}>
            {d.posts.length === 0 ? (
              <div className="hole">空档</div>
            ) : d.posts.map((p, i) => {
              const km = KIND_META[p.kind];
              const cls = p.state === "scheduled" ? " clip--sched" : p.state === "draft" ? " clip--draft" : "";
              return (
                <div className={`clip${cls}`} key={i} title={`${p.ch} · ${STATE_META[p.state].label}`}>
                  <Icon2 name={km.icon} style={{ width: 12, height: 12 }} />
                  <span>{p.ch}</span>
                  <span className="clip__slug">{STATE_META[p.state].label}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════ 今天 ══════════════ */
function Today2({ dir, onGo }) {
  const isCut = dir === "cut";
  const isNote = dir === "note";

  const Head = (
    <div className="between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
      <div className="stack" style={{ gap: isCut ? 10 : 6 }}>
        <p className="kicker">
          {isCut ? "SUNNY SHUTTERS / 多伦多 / 第 31 周" : "SUNNY SHUTTERS · 多伦多"}
        </p>
        <h1 className="h1">
          {isCut ? <>本周还有<span style={{ color: "var(--accent)" }}> 2 </span>个空档</>
                 : "这周还差 2 条就够节奏了"}
        </h1>
        {!isCut && <p className="sub">你设定的节奏是每周 5 条。已发 3 条、排期 2 条，周四和周六是空的。</p>}
      </div>
      <button type="button" className="btn btn--primary" onClick={() => onGo("create")}>
        <Icon2 name="IcWand" />{isCut ? "开机" : "开始创作"}
      </button>
    </div>
  );

  return (
    <div className="stack" data-screen-label="今天">
      {isCut ? (
        <React.Fragment>
          <div style={{ padding: "26px 24px 20px" }}>{Head}</div>
          <WeekTrack />
        </React.Fragment>
      ) : (
        <div className="canvas" style={{ paddingBottom: 0 }}>{Head}</div>
      )}

      <div className="canvas" style={isCut ? { padding: 0 } : undefined}>
        {/* 本子方向：一周用便签铺开 */}
        {isNote && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(7, minmax(0,1fr))" }}>
            {WEEK.map((d) => (
              <div className="sticky" key={d.date} style={{ minHeight: 128 }}>
                <div className="between" style={{ marginBottom: 10 }}>
                  <span style={{ fontFamily: "var(--display)", fontSize: 15 }}>{d.day}</span>
                  <span className="num" style={{ color: "var(--ink-3)", fontSize: "var(--meta)" }}>{d.date}</span>
                </div>
                {d.posts.length === 0
                  ? <span style={{ color: "var(--ink-3)", fontSize: "var(--meta)" }}>还空着</span>
                  : d.posts.map((p, i) => (
                      <div className="row" key={i} style={{ gap: 7, fontSize: "var(--meta)", color: "var(--ink-2)" }}>
                        <span className="dot" style={{ background: p.state === "published" ? "var(--good)" : p.state === "draft" ? "var(--warn)" : "var(--ink-3)" }} />
                        {p.ch}
                      </div>
                    ))}
              </div>
            ))}
          </div>
        )}

        {/* 常规方向：仍用卡片网格，作为对照 */}
        {dir === "plain" && (
          <div className="card">
            <div className="card__hd"><h2 className="h2">本周节奏</h2>
              <button type="button" className="btn btn--ghost" onClick={() => onGo("calendar")}>去日历<Icon2 name="IcArrow" /></button>
            </div>
            <div className="card__bd">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8 }}>
                {WEEK.map((d) => (
                  <div className="stack" key={d.date} style={{
                    gap: 8, padding: 10, border: "1px solid var(--line)",
                    borderStyle: d.posts.length ? "solid" : "dashed",
                    background: d.posts.length ? "var(--panel-2)" : "transparent", minHeight: 96,
                  }}>
                    <div className="between">
                      <span style={{ fontSize: "var(--meta)", color: "var(--ink-2)" }}>{d.day}</span>
                      <span className="num" style={{ fontSize: "var(--meta)", color: "var(--ink-3)" }}>{d.date}</span>
                    </div>
                    {d.posts.length === 0
                      ? <span style={{ fontSize: "var(--meta)", color: "var(--ink-3)", marginTop: "auto" }}>空</span>
                      : d.posts.map((p, i) => (
                          <div className="row" key={i} style={{ gap: 6, fontSize: "var(--meta)", color: "var(--ink-2)" }}>
                            <span className="dot" style={{ background: p.state === "published" ? "var(--good)" : p.state === "draft" ? "var(--warn)" : "var(--ink-3)" }} />
                            {p.ch}
                          </div>
                        ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 两栏：等你决定 / 哪个结构在赢 */}
        <div className="grid" style={{
          gridTemplateColumns: isNote ? "1fr" : "1.05fr .95fr",
          ...(isCut ? { flex: 1, alignItems: "stretch" } : {}),
        }}>
          <div className="card">
            <div className="card__hd">
              <h2 className="h2">{isCut ? "待处理" : "等你决定"}</h2>
              <span className="num" style={{ color: "var(--ink-3)", fontSize: "var(--meta)" }}>3</span>
            </div>
            <div className="stack">
              {TODOS.map((t, i) => (
                <div className="between" key={t.id}
                     style={{ padding: isCut ? "13px 24px" : isNote ? 20 : 14,
                              borderTop: i ? "1px solid var(--line)" : "none",
                              alignItems: "flex-start", gap: 14 }}>
                  <div className="row" style={{ gap: 11, alignItems: "flex-start", minWidth: 0 }}>
                    <span className="dot" style={{ marginTop: 9,
                      background: t.tone === "warn" ? "var(--warn)" : t.tone === "good" ? "var(--good)" : "var(--ink-3)" }} />
                    <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{t.title}</span>
                      <span style={{ color: "var(--ink-2)", fontSize: "var(--meta)" }}>{t.body}</span>
                    </div>
                  </div>
                  <button type="button" className="btn" style={{ flexShrink: 0 }}>{t.cta}</button>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card__hd">
              <div className="stack" style={{ gap: 2 }}>
                <h2 className="h2">{isCut ? "配方战绩" : "哪个结构在赢"}</h2>
                {!isCut && <span style={{ color: "var(--ink-3)", fontSize: "var(--meta)" }}>近 30 天 · 按创意配方，不是按帖子</span>}
              </div>
              <button type="button" className="btn btn--ghost" onClick={() => onGo("racing")}>全部<Icon2 name="IcArrow" /></button>
            </div>
            <div className="stack">
              {RECIPES.map((r, i) => (
                <div className="between" key={r.id}
                     style={{ padding: isCut ? "11px 24px" : isNote ? "16px 20px" : 14,
                              borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="row" style={{ gap: 9 }}>
                      {isCut && <span className="slug">{slugOf(r.id, r.n)}</span>}
                      <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                      {r.state === "thin" && <span className="tag tag--mute">样本不足</span>}
                    </span>
                    {!isCut && <span style={{ color: "var(--ink-3)", fontSize: "var(--meta)" }}>{r.note}</span>}
                  </div>
                  <div className="row" style={{ gap: 15, flexShrink: 0 }}>
                    <span className="num" style={{ color: "var(--ink-3)", fontSize: "var(--meta)" }}>n={r.n}</span>
                    <Spark2 points={r.trend} tone={r.state} />
                    <span className="num" style={{
                      width: 54, textAlign: "right", fontWeight: 600,
                      fontSize: isCut ? 15 : "inherit",
                      color: r.lift === null ? "var(--ink-3)" : r.lift >= 1.5 ? "var(--good)" : r.lift < 1 ? "var(--bad)" : "var(--ink-2)",
                    }}>{r.lift === null ? "—" : `${r.lift.toFixed(1)}×`}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════ 创作 ══════════════ */
function Create2({ dir }) {
  const isCut = dir === "cut", isNote = dir === "note";
  const [seed, setSeed] = React.useState(SEED);
  const [picked, setPicked] = React.useState(["o1", "o2", "o4"]);
  const toggle = (id) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  return (
    <div className="stack" data-screen-label="创作">
      <div className={isCut ? "" : "canvas"} style={isCut ? { padding: "26px 24px 20px" } : { paddingBottom: 0 }}>
        <div className="stack" style={{ gap: isCut ? 10 : 6 }}>
          <p className="kicker">{isCut ? "创作 / 开机单" : "创作"}</p>
          <h1 className="h1">{isCut ? "一句话，一场戏" : "说一句话，这周的内容就有了"}</h1>
          {!isCut && <p className="sub">也可以放一张产品图或一个商品链接。三种入口进同一条流水线。</p>}
        </div>
      </div>

      <div className="canvas" style={isCut ? { padding: 0 } : undefined}>
        <div className="card">
          <div className="card__bd stack" style={{ gap: 15 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {["一句话", "一张产品图", "商品链接"].map((t, i) => (
                <button className="chip" key={t} type="button" aria-pressed={i === 0}>{t}</button>
              ))}
            </div>
            <textarea value={seed} onChange={(e) => setSeed(e.target.value)} rows={isNote ? 3 : 2}
              style={{
                width: "100%", resize: "vertical", padding: "13px 15px",
                background: "var(--panel-2)", color: "var(--ink)",
                border: "1px solid var(--line)", borderRadius: "var(--r)",
                font: "inherit", fontSize: "calc(var(--body) + 1px)", lineHeight: 1.75,
                fontFamily: isNote ? "var(--display)" : "var(--sans)",
              }} />
            <div className="between" style={{ flexWrap: "wrap", gap: 12 }}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="tag tag--mute">品牌包 SunnyShutter</span>
                <span className="tag tag--good">自然植入</span>
                <span className="tag tag--mute">一周 5 条</span>
              </div>
              <button type="button" className="btn btn--primary"><Icon2 name="IcWand" />{isCut ? "开拍" : "产出这周内容"}</button>
            </div>
          </div>
        </div>

        <div className="between" style={{ padding: isCut ? "18px 24px 10px" : "0", flexWrap: "wrap", gap: 10 }}>
          <h2 className="h2">{isCut ? "四条轨道，一次产出" : "一次产出四种形态"}</h2>
          <span style={{ color: "var(--ink-3)", fontSize: "var(--meta)" }}>
            已选 <span className="num">{picked.length}</span> / 4 进日历
          </span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: isNote ? "repeat(2, minmax(0,1fr))" : "repeat(4, minmax(0,1fr))" }}>
          {OUTPUTS.map((o) => {
            const km = KIND_META[o.kind], on = picked.includes(o.id);
            return (
              <div className="card" key={o.id}
                   style={{ borderColor: on ? "var(--accent)" : "var(--line)", display: "flex", flexDirection: "column" }}>
                <div className="card__hd">
                  <span className="row" style={{ gap: 8 }}>
                    <Icon2 name={km.icon} style={{ width: 15, height: 15, color: "var(--accent)" }} />
                    <span style={{ fontWeight: 600 }}>{o.label}</span>
                  </span>
                  <span className="num" style={{ color: "var(--ink-3)", fontSize: "var(--meta)" }}>{o.spec}</span>
                </div>

                <div style={{
                  margin: isCut ? "20px auto 0" : "16px auto 0", width: "fit-content",
                  aspectRatio: o.kind === "video" ? "9 / 16" : o.kind === "carousel" ? "4 / 5" : o.kind === "image" ? "1 / 1" : "3 / 2",
                  maxHeight: isNote ? 220 : 152,
                  border: "1px dashed var(--line-2)", borderRadius: "var(--r)",
                  background: "var(--panel-2)", display: "grid", placeItems: "center",
                  color: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em",
                }}>{o.spec}</div>

                <div className="card__bd stack" style={{ gap: 11, marginTop: "auto" }}>
                  <div className="stack" style={{ gap: 4 }}>
                    {isCut && <span className="slug">配方 {o.recipe}</span>}
                    <span style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: "calc(var(--body) + 2px)" }}>{o.title}</span>
                    {!isCut && (
                      <span className="row" style={{ gap: 6, color: "var(--ink-3)", fontSize: "var(--meta)" }}>
                        <Icon2 name="IcSpark" style={{ width: 12, height: 12 }} />配方 · {o.recipe}
                      </span>
                    )}
                  </div>
                  {!isCut && <p className="sub" style={{ fontSize: "var(--meta)", color: "var(--ink-2)" }}>{o.note}</p>}
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn" onClick={() => toggle(o.id)} style={{ flex: 1, justifyContent: "center" }}>
                      {on ? <><Icon2 name="IcCheck" />已进日历</> : "加入日历"}
                    </button>
                    <button type="button" className="btn btn--ghost">改一版</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ color: "var(--ink-3)", fontSize: "var(--meta)", margin: isCut ? "16px 24px 28px" : 0 }}>
          改一版不额外扣费；失败或被安全拦截的任务不计费。
        </p>
      </div>
    </div>
  );
}

function Stub2({ id }) {
  const m = { calendar: "日历", library: "素材库", intel: "同行灵感", racing: "战绩", brand: "品牌包", ia: "信息架构" };
  return (
    <div className="canvas" style={{ padding: 48, gap: 10 }} data-screen-label={m[id]}>
      <p className="kicker">{m[id]}</p>
      <h1 className="h1">本稿未展开</h1>
      <p className="sub">
        {id === "ia"
          ? "信息架构全景在 v1 稿里（index.html），本稿专注视觉方向对比。"
          : "这轮只把「今天」与「创作」做到高保真。需要哪一屏展开随时说。"}
      </p>
    </div>
  );
}

Object.assign(window, { Today2, Create2, Stub2, Icon2, WeekTrack });
