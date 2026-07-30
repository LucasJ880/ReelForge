/* App v2：状态只有两个 —— 当前去处 + 当前方向 */

const DIRS2 = [
  { id: "plain", name: "常规", hint: "上一稿，留作对照" },
  { id: "cut",   name: "剪辑台", hint: "胶片 / 场记板 / 时间线轨道" },
  { id: "note",  name: "店主本子", hint: "纸 / 宋体 / 便签" },
];

function App2() {
  const [dir, setDir] = React.useState(() => localStorage.getItem("aivora-os-v2-dir") || "cut");
  const [route, setRoute] = React.useState("today");

  React.useEffect(() => {
    document.documentElement.setAttribute("data-dir", dir);
    localStorage.setItem("aivora-os-v2-dir", dir);
  }, [dir]);

  return (
    <React.Fragment>
      <div className="shell">
        <nav className="nav" aria-label="主导航">
          <div className="brand">
            <span className="brand__mark">A</span>
            <span className="stack" style={{ gap: 0 }}>
              <span className="brand__name">Aivora</span>
              <span className="brand__sub">SUNNY Shutters</span>
            </span>
          </div>

          {NAV.filter((g) => g.group !== "本设计稿").map((g) => (
            <div className="navgroup" key={g.group}>
              <span className="navgroup__label">{g.group}</span>
              {g.items.map((it) => (
                <button key={it.id} type="button" className="navitem"
                        aria-current={route === it.id ? "page" : undefined}
                        onClick={() => setRoute(it.id)}>
                  <Icon2 name={it.icon} />
                  <span>{it.label}</span>
                  {it.count && <span className="navitem__count">{it.count}</span>}
                </button>
              ))}
            </div>
          ))}

          <div className="stack" style={{ gap: 6, marginTop: "auto", padding: "0 16px" }}>
            <span className="navgroup__label" style={{ padding: 0 }}>本月消耗</span>
            <span className="between">
              <span className="num" style={{ fontWeight: 600, fontSize: 15 }}>18 / 40</span>
              <span className="tag tag--good">正常</span>
            </span>
          </div>
        </nav>

        <main className="main">
          <div className="perf" aria-hidden="true"></div>
          {route === "today" && <Today2 dir={dir} onGo={setRoute} />}
          {route === "create" && <Create2 dir={dir} />}
          {!["today", "create"].includes(route) && <Stub2 id={route} />}
        </main>
      </div>

      <div className="switcher" role="group" aria-label="设计方向">
        <span className="switcher__label">方向</span>
        {DIRS2.map((d) => (
          <button key={d.id} type="button" className="chip" aria-pressed={dir === d.id}
                  title={d.hint} onClick={() => setDir(d.id)}>
            {d.name}
          </button>
        ))}
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App2 />);
