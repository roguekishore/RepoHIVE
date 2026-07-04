import "./styles/components.css";
import { content as c } from "./content";
import { Mockup } from "./components/Mockups";
import { HeroAurora, SectionGlow, Grain } from "./components/Atmosphere";

export default function App() {
  return (
    <>
    <Grain />
      <Nav />
      <main>
        <Hero />
        <StatsAndMetrics />
        <Audience />
        <TwoAudiences />
        <HowItWorks />
        <Layers />
        <Claims />
        <Blast />
        <Contract />
        <Pricing />
      </main>
      <Footer />
    </>
  );
}

/* ---------------- NAV ---------------- */
function Nav() {
  return (
    <header className="nav">
      <div className="container nav__inner">
        <a className="nav__brand" href="#">
          <span className="nav__logo">◆</span>
          {c.brand.name}
        </a>
        <nav className="nav__links">
          {c.nav.map((n) => (
            <a key={n.label} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="nav__right">
          <span className="nav__star">★ {c.brand.star}</span>
          <span className="nav__install">{c.brand.install}</span>
          <button className="btn btn--primary">{c.cta.secondary}</button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- HERO ---------------- */
function Hero() {
  return (
    <section className="hero">
      <HeroAurora />
      <div className="container hero__content">
        <div className="hero__eyebrow">
          <span className="eyebrow">{c.hero.eyebrow}</span>
        </div>
        <h1 className="display display--xl hero__title">
          {c.hero.title.map((line, i) => (
            <span key={i}>
              {line} <br />
            </span>
          ))}
          <em>{c.hero.titleEm}</em>
        </h1>
        <p className="lede hero__body">{c.hero.body}</p>
        <div className="hero__search">
          <span className="hero__search-icon">⌕</span>
          <input type="text" placeholder={c.hero.searchPlaceholder} aria-label="repo url" />
          <button className="btn btn--primary">{c.hero.searchButton}</button>
        </div>
      </div>
    </section>
  );
}

/* ---------------- STATS + METRICS ---------------- */
function StatsAndMetrics() {
  return (
    <section className="section--alt">
      <div className="container">
        <div className="stats">
          {c.stats.map((s) => (
            <div key={s.label} className="stat">
              <div className="stat__value">{s.value}</div>
              <div className="stat__label">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="metrics">
          {c.metrics.map((m) => (
            <div key={m.title} className="metric">
              <div className="metric__value">{m.value}</div>
              <div className="metric__title">{m.title}</div>
              <p className="metric__body">{m.body}</p>
            </div>
          ))}
        </div>
        <p className="metrics__caption">
          Engineering estimates at the thousands-of-files scale — every claim reproducible on your own repo.
        </p>
      </div>
    </section>
  );
}

/* ---------------- AUDIENCE CARD GRID ---------------- */
function Audience() {
  const a = c.audience;
  return (
    <section className="section">
      <div className="container">
        <div className="sec-head">
          <span className="eyebrow">{a.eyebrow}</span>
          <h2 className="display display--lg sec-head__title">
            {a.title} <em>{a.titleEm}</em>
          </h2>
          <p className="lede">{a.body}</p>
        </div>
        <div className="cardgrid">
          {a.cards.map((card) => (
            <article key={card.title} className="card fcard">
              <div className="fcard__icon">{card.icon}</div>
              <h3 className="fcard__title">{card.title}</h3>
              <p className="fcard__body">{card.body}</p>
              <a className="fcard__link" href="#">
                {card.link} →
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- TWO AUDIENCES SPLIT ---------------- */
function TwoAudiences() {
  const t = c.twoAudiences;
  const Panel = ({ p }: { p: typeof t.left }) => (
    <div className="card duo__panel">
      <div className="duo__label">{p.label}</div>
      <h3 className="duo__heading">{p.heading}</h3>
      {p.items.map((it) => (
        <div key={it.title} className="duo__item">
          <div>
            <div className="duo__item-title">{it.title}</div>
            <div className="duo__item-body">{it.body}</div>
          </div>
          <span className="duo__arrow">↗</span>
        </div>
      ))}
    </div>
  );
  return (
    <section className="section--alt section">
      <div className="container">
        <div className="sec-head">
          <span className="eyebrow">{t.eyebrow}</span>
          <h2 className="display display--lg sec-head__title">
            {t.title} <em>{t.titleEm}</em>
          </h2>
          <p className="lede">{t.body}</p>
        </div>
        <div className="duo">
          <Panel p={t.left} />
          <Panel p={t.right} />
        </div>
      </div>
    </section>
  );
}

/* ---------------- HOW IT WORKS (stages) ---------------- */
function HowItWorks() {
  const h = c.howItWorks;
  return (
    <section className="section">
      <div className="container">
        <div className="sec-head">
          <span className="eyebrow">{h.eyebrow}</span>
          <h2 className="display display--lg sec-head__title">
            {h.title} <em>{h.titleEm}</em>
          </h2>
          <p className="lede">{h.body}</p>
        </div>
        <div className="stages">
          {h.interfaces.map((s) => (
            <article key={s.name} className="card stage">
              <div className="stage__icon">{s.icon}</div>
              <h3 className="stage__name">{s.name}</h3>
              <div className="stage__audience">{s.audience}</div>
              <div className="stage__code">
                {s.lines.map((line, i) => (
                  <code key={i} className={`stage__line${i === 0 ? " stage__line--cmd" : ""}`}>
                    {line}
                  </code>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- LAYERS / SPLIT FEATURES ---------------- */
function Layers() {
  const l = c.layers;
  return (
    <section className="section--alt section">
      <div className="container">
        <div className="sec-head">
          <span className="eyebrow">{l.eyebrow}</span>
          <h2 className="display display--lg sec-head__title">
            {l.title} <em>{l.titleEm}</em>
          </h2>
          <p className="lede">{l.body}</p>
        </div>
        {l.features.map((f) => (
          <div key={f.title} className={`split${f.reverse ? " split--reverse" : ""}`}>
            <div className="split__text">
              <span className="eyebrow">{f.eyebrow}</span>
              <h3 className="split__title">
                {f.title} <em>{f.titleEm}</em>
              </h3>
              <ul className="split__points">
                {f.points.map((p) => (
                  <li key={p} className="split__point">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="split__visual">
              <Mockup kind={f.mockup} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- CLAIMS PANEL ---------------- */
function Claims() {
  const cl = c.claims;
  return (
    <section className="section claims-section">
      <SectionGlow tone="violet" />
      <div className="container">
        <div className="panel">
          <div>
            <span className="eyebrow">{cl.eyebrow}</span>
            <h2 className="display display--lg sec-head__title panel__title">
              {cl.title} <em>{cl.titleEm}</em>
            </h2>
            <p className="lede">{cl.body}</p>
            <div className="panel__actions">
              <button className="btn btn--primary">{cl.ctaPrimary}</button>
              <a className="btn btn--link" href="#">
                {cl.ctaSecondary} →
              </a>
            </div>
          </div>
          <div className="panel__cards">
            {cl.cards.map((card) => (
              <div key={card.tag} className="claimcard">
                <div className="claimcard__value">{card.value}</div>
                <div>
                  <span className="claimcard__tag">{card.tag}</span>
                  <p className="claimcard__body">{card.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- BLAST RADIUS ---------------- */
function Blast() {
  const b = c.prBot;
  return (
    <section className="section--alt section">
      <div className="container">
        <div className="sec-head">
          <span className="eyebrow">{b.eyebrow}</span>
          <h2 className="display display--lg sec-head__title">
            {b.title} <em>{b.titleEm}</em>
          </h2>
          <p className="lede">{b.body}</p>
        </div>
        <div className="blast">
          <div className="blast__points">
            {b.points.map((p) => (
              <div key={p.title}>
                <div className="blast__point-title">{p.title}</div>
                <div className="blast__point-body">{p.body}</div>
              </div>
            ))}
            <div className="blast__actions">
              <button className="btn btn--primary">{b.ctaPrimary}</button>
              <button className="btn btn--ghost">{b.ctaSecondary}</button>
            </div>
          </div>
          <div className="card split__visual">
            <Mockup kind="git" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- JSON CONTRACT ---------------- */
function Contract() {
  const m = c.mcp;
  return (
    <section className="section">
      <div className="container">
        <div className="sec-head">
          <span className="eyebrow">{m.eyebrow}</span>
          <h2 className="display display--lg sec-head__title">
            {m.title} <em>{m.titleEm}</em>
          </h2>
          <p className="lede">{m.body}</p>
        </div>
        <div className="contract">
          <div className="contract__list">
            {m.tools.slice(0, 5).map((t) => (
              <div key={t.name} className="contract__item">
                <div>
                  <span className="contract__name">{t.name}</span>{" "}
                  <span className="contract__body">— {t.body}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="contract__list">
            {m.tools.slice(5).map((t) => (
              <div key={t.name} className="contract__item">
                <div>
                  <span className="contract__name">{t.name}</span>{" "}
                  <span className="contract__body">— {t.body}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- PRICING + CONTACT ---------------- */
function Pricing() {
  const p = c.pricing;
  return (
    <section className="section--alt section">
      <div className="container">
        <div className="pricing">
          <div className="pricing__items">
            {p.items.map((item) => (
              <div key={item.title}>
                <div className="pricing__item-title">{item.title}</div>
                {"install" in item && item.install && (
                  <div className="pricing__item-accent">{item.install}</div>
                )}
                {"accent" in item && item.accent && (
                  <div className="pricing__item-accent">{item.accent}</div>
                )}
                <p className="pricing__item-body">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="contact">
            <div className="contact__tabs">
              {p.form.tabs.map((tab, i) => (
                <button key={tab} className={`contact__tab${i === 0 ? " contact__tab--active" : ""}`}>
                  {tab}
                </button>
              ))}
            </div>
            <label className="contact__label">{p.form.label}</label>
            <textarea className="contact__textarea" placeholder={p.form.placeholder} />
            <button className="btn btn--primary contact__send">{p.form.button}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- FOOTER ---------------- */
function Footer() {
  const f = c.footer;
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__top">
          <div>
            <a className="nav__brand" href="#">
              <span className="nav__logo">◆</span>
              {c.brand.name}
            </a>
            <p className="footer__tagline">{f.tagline}</p>
          </div>
          {f.columns.map((col) => (
            <div key={col.title} className="footer__col">
              <div className="footer__col-title">{col.title}</div>
              {col.links.map((link) => (
                <a key={link} href="#">
                  {link}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className="footer__bottom">
          <span className="footer__status">
            <span className="footer__dot" />
            {f.status}
          </span>
          <div className="footer__bottom-right">
            <span>{f.copyright}</span>
            <span className="mono">{f.email}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
