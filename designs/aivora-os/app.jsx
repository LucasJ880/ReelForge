/* App：持有全部状态（当前去处 + 设计方向），其余组件都是展示型 */

const DIRS = [
  { id: "desk", name: "值班台", hint: "深色高密度 · 运营每天开着看" },
  { id: "calm", name: "顺手台", hint: "浅色低密度 · 小商家自助" },
];

function App() {
  const [dir, setDir] = React.useState(() => localStorage.getItem("aivora-os-dir") || "desk");
  const [route, setRoute] = React.useState("today");

  React.useEffect(() => {
    document.documentElement.setAttribute("data-dir", dir);
    localStorage.setItem("aivora-os-dir", dir);
  }, [dir]);

  const dense = dir === "desk";

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

          {NAV.map((g) => (
            <div className="navgroup" key={g.group}>
              <span className="navgroup__label">{g.group}</span>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="navitem"
                  aria-current={route === it.id ? "page" : undefined}
                  onClick={() => setRoute(it.id)}
                >
                  <Icon name={it.icon} />
                  <span>{it.label}</span>
                  {it.count && <span className="navitem__count">{it.count}</span>}
                </button>
              ))}
            </div>
          ))}

          <div className="stack" style={{ gap: 6, marginTop: "auto", padding: "0 8px" }}>
            <span className="navgroup__label" style={{ padding: 0 }}>本月消耗</span>
            <span className="row" style={{ justifyContent: "space-between" }}>
              <span className="num" style={{ fontWeight: 650 }}>18 / 40 条</span>
              <span className="tag tag--good">正常</span>
            </span>
          </div>
        </nav>

        <main className="main">
          {route === "today" && <ScreenToday dense={dense} onGo={setRoute} />}
          {route === "create" && <ScreenCreate dense={dense} />}
          {route === "ia" && <ScreenIA dense={dense} />}
          {!["today", "create", "ia"].includes(route) && <ScreenStub id={route} />}
        </main>
      </div>

      <div className="switcher" role="group" aria-label="设计方向">
        <span className="switcher__label">方向</span>
        {DIRS.map((d) => (
          <button
            key={d.id}
            type="button"
            className="chip"
            aria-pressed={dir === d.id}
            title={d.hint}
            onClick={() => setDir(d.id)}
          >
            {d.name}
          </button>
        ))}
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
