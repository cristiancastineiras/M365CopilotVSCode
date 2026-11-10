// Mejoras opcionales: la web funciona igual sin JavaScript.
const repo = document.body.dataset.repo;

// Menú móvil
const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("site-nav");
if (toggle && nav) {
  toggle.hidden = false;
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

// Botones «Copiar»
document.querySelectorAll("[data-copy]").forEach((btn) => {
  const label = btn.textContent;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = btn.dataset.done || "OK";
      setTimeout(() => (btn.textContent = label), 1800);
    } catch {
      /* sin permiso de portapapeles: el texto sigue visible para copiarlo a mano */
    }
  });
});

// Enlaces de descarga exactos. El .vsix lleva la versión en el nombre (m365-copilot-vscode-X.Y.Z.vsix),
// así que no tiene URL fija: se pide la última release y se enlaza el archivo. Sin JS o sin red queda
// el enlace a la página de la release.
const targets = document.querySelectorAll("[data-ext]");
if (repo && targets.length) {
  const key = "m365-latest-release";
  const apply = (release) => {
    for (const a of targets) {
      const asset = release.assets?.find((x) => x.name.endsWith(`.${a.dataset.ext}`));
      if (asset) a.href = asset.browser_download_url;
    }
    document.querySelectorAll("[data-version]").forEach((el) => {
      el.textContent = release.tag_name;
      el.closest("[data-release]")?.removeAttribute("hidden");
    });
  };
  let cached = null;
  try {
    cached = JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    /* sessionStorage bloqueado */
  }
  if (cached) apply(cached);
  else {
    fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        const release = { tag_name: data.tag_name, assets: data.assets.map(({ name, browser_download_url }) => ({ name, browser_download_url })) };
        try {
          sessionStorage.setItem(key, JSON.stringify(release));
        } catch {
          /* ignorar */
        }
        apply(release);
      })
      .catch(() => {});
  }
}

// Ilustración del hero: recorre los estados de la extensión (busca el token → lo captura y busca VS Code →
// conectado). Con movimiento reducido se queda en «conectado», que es como ya viene en el HTML.
const art = document.querySelector("[data-art]");
if (art && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const caption = art.querySelector("[data-caption]");
  const steps = [["waiting", 2400], ["captured", 3600], ["connected", 6500]];
  let i = 0;
  const next = () => {
    const [state, ms] = steps[i++ % steps.length];
    art.dataset.state = state;
    if (caption) caption.textContent = caption.dataset[state];
    setTimeout(next, ms);
  };
  next();
}

// Contador de estrellas del botón «Dar una estrella». Si la API no responde (sin red, límite de peticiones) el
// botón sigue siendo un enlace normal al repositorio, sin número.
const starEls = document.querySelectorAll("[data-stars]");
if (repo && starEls.length) {
  const show = (count) => {
    const text = new Intl.NumberFormat(document.documentElement.lang || "en", { notation: "compact" }).format(count);
    starEls.forEach((el) => {
      el.textContent = text;
      el.hidden = false;
    });
  };
  let cachedStars = null;
  try {
    cachedStars = Number(sessionStorage.getItem("m365-stars"));
  } catch {
    /* sessionStorage bloqueado */
  }
  if (cachedStars) show(cachedStars);
  else {
    fetch(`https://api.github.com/repos/${repo}`, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        try {
          sessionStorage.setItem("m365-stars", String(data.stargazers_count));
        } catch {
          /* ignorar */
        }
        show(data.stargazers_count);
      })
      .catch(() => {});
  }
}

// Cifras de descargas: instalaciones y descargas de la Marketplace más las descargas de las releases de GitHub.
// Son datos en directo y se guardan una hora; si las API no responden se usa la última copia, y sin ninguna la
// sección se oculta: un total con una fuente de menos sería mentira.
const stats = document.querySelector("[data-stats]");
if (stats && repo) {
  const CACHE_KEY = "m365-download-stats";
  const CACHE_MS = 60 * 60 * 1000;
  // Con más no caben en escritorio etiquetas como v4.0.10. El total y la tabla cuentan todas las versiones.
  const MAX_COLUMNS = 10;
  const lang = document.documentElement.lang || "en";
  const number = new Intl.NumberFormat(lang, { useGrouping: "always" });
  const percent = new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium" });
  const panel = stats.querySelector(".stats-panel");
  const tip = stats.querySelector("[data-stats-tip]");

  const json = (r) => (r.ok ? r.json() : Promise.reject(r.status));
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const fetchMarketplace = () =>
    fetch("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json;api-version=7.1-preview.1" },
      // filterType 7 = nombre de la extensión; flags 256 = con sus estadísticas.
      body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: stats.dataset.market }] }], flags: 256 }),
    })
      .then(json)
      .then((data) => {
        const list = data.results[0].extensions[0].statistics;
        const value = (name) => list.find((s) => s.statisticName === name)?.value ?? 0;
        return { installs: value("install"), vsix: value("downloadCount") };
      });

  const fetchReleases = async () => {
    const releases = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
        headers: { Accept: "application/vnd.github+json" },
      }).then(json);
      for (const r of batch) {
        releases.push({ tag: r.tag_name, date: r.published_at, count: r.assets.reduce((sum, a) => sum + a.download_count, 0) });
      }
      if (batch.length < 100) break;
    }
    return releases.sort((a, b) => a.date.localeCompare(b.date));
  };

  /** La parte de arriba del eje: el primer número redondo que no se queda corto. */
  const niceMax = (max) => {
    const power = 10 ** Math.floor(Math.log10(max));
    return [1, 2, 2.5, 5, 10].map((step) => step * power).find((top) => top >= max);
  };

  const renderSplit = (parts, total) => {
    const split = stats.querySelector("[data-stats-split]");
    split.replaceChildren();
    for (const part of parts) {
      if (!part.value) continue;
      const seg = el("span", "stats-seg");
      seg.dataset.series = part.series;
      seg.style.flexGrow = part.value;
      seg.dataset.tip = number.format(part.value);
      seg.dataset.tipLabel = `${part.label} · ${percent.format(part.value / total)} ${stats.dataset.share}`;
      split.append(seg);
    }
    split.setAttribute("aria-label", parts.map((p) => `${p.label}: ${number.format(p.value)} (${percent.format(p.value / total)})`).join(", "));
  };

  const renderChart = (releases) => {
    const plot = stats.querySelector("[data-stats-plot]");
    plot.replaceChildren();
    const shown = releases.slice(-MAX_COLUMNS);
    const max = Math.max(...shown.map((r) => r.count));
    if (!max) return;
    const top = niceMax(max);
    const area = el("div", "stats-area");
    for (const value of [0, top / 2, top]) {
      const line = el("div", "stats-gridline");
      line.style.bottom = `${(value / top) * 100}%`;
      line.append(el("span", "stats-tick", number.format(value)));
      area.append(line);
    }
    const cols = el("div", "stats-cols");
    const peak = shown.findIndex((r) => r.count === max);
    shown.forEach((release, i) => {
      // Se puede enfocar para leer su detalle con el teclado, pero no es un botón: pulsarla no hace nada.
      const col = el("div", "stats-col");
      col.tabIndex = 0;
      col.setAttribute("role", "img");
      col.style.setProperty("--i", i);
      col.style.setProperty("--h", `${(release.count / top) * 100}%`);
      col.dataset.series = "2";
      col.dataset.tip = number.format(release.count);
      col.dataset.tipLabel = `${release.tag} · ${date.format(new Date(release.date))}`;
      col.setAttribute("aria-label", `${release.tag}: ${number.format(release.count)} ${stats.dataset.unit}`);
      if (release.count) col.append(el("span", "stats-bar"));
      if (i === peak) col.append(el("span", "stats-cap", number.format(release.count)));
      col.append(el("span", "stats-x", release.tag));
      cols.append(col);
    });
    area.append(cols);
    plot.append(area);

    stats.querySelector("[data-stats-rows]").replaceChildren(
      ...[...releases].reverse().map((release) => {
        const row = el("tr");
        row.append(el("td", "", release.tag), el("td", "", date.format(new Date(release.date))), el("td", "", number.format(release.count)));
        return row;
      }),
    );
  };

  // Una sola caja de detalle para todas las marcas. Nunca es la única forma de ver un valor: están también las
  // cifras de al lado y la tabla.
  let tipMark = null;
  const showTip = (mark) => {
    tipMark = mark;
    const key = el("i", "stats-tip-key");
    key.dataset.series = mark.dataset.series;
    const label = el("span", "stats-tip-label");
    label.append(key, document.createTextNode(mark.dataset.tipLabel));
    tip.replaceChildren(el("strong", "", mark.dataset.tip), label);
    tip.hidden = false;
    const box = panel.getBoundingClientRect();
    // Por encima de la cifra de la columna más alta, si es esa, para no taparla.
    const anchor = mark.querySelector(".stats-cap") || mark.querySelector(".stats-bar") || mark;
    const target = anchor.getBoundingClientRect();
    const left = target.left + target.width / 2 - box.left - tip.offsetWidth / 2;
    tip.style.left = `${Math.max(8, Math.min(left, box.width - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8, target.top - box.top - tip.offsetHeight - 8)}px`;
  };
  const hideTip = () => {
    tipMark = null;
    tip.hidden = true;
  };
  const tipFrom = (event) => {
    const mark = event.target.closest?.("[data-tip]");
    if (mark) showTip(mark);
    else hideTip();
  };
  panel.addEventListener("pointerover", tipFrom);
  panel.addEventListener("focusin", tipFrom);
  // En táctil el dedo «sale» al levantarse: ahí el detalle se queda hasta tocar en otro sitio.
  panel.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") hideTip();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!panel.contains(e.target)) hideTip();
  });
  panel.addEventListener("focusout", (e) => {
    if (e.target === tipMark) hideTip();
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  });

  const countUp = (items) => {
    const finish = () => items.forEach(([node, value]) => (node.textContent = number.format(value)));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return finish();
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / 1300);
      const eased = 1 - (1 - t) ** 3;
      items.forEach(([node, value]) => (node.textContent = number.format(Math.round(value * eased))));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const render = ({ market, releases }) => {
    const github = releases.reduce((sum, r) => sum + r.count, 0);
    const values = { installs: market.installs, github, vsix: market.vsix };
    const parts = [...stats.querySelectorAll("[data-part]")].map((tile) => ({
      tile,
      series: tile.dataset.series,
      label: tile.querySelector("[data-label]").textContent,
      value: values[tile.dataset.part],
    }));
    const total = parts.reduce((sum, p) => sum + p.value, 0);
    renderSplit(parts, total);
    renderChart(releases);

    // Cada bloque se anima al entrar en pantalla: en móvil van uno debajo de otro y la gráfica llega más tarde.
    const reveal = (block, then) => {
      const show = () => {
        block.classList.add("is-in");
        then?.();
      };
      if (!("IntersectionObserver" in window)) return show();
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          show();
        },
        { rootMargin: "0px 0px -15% 0px" },
      );
      observer.observe(block);
    };
    reveal(stats.querySelector(".stats-summary"), () =>
      countUp([[stats.querySelector("[data-stats-total]"), total], ...parts.map((p) => [p.tile.querySelector("[data-value]"), p.value])]),
    );
    reveal(stats.querySelector(".stats-chart"));
  };

  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  } catch {
    /* localStorage bloqueado */
  }
  if (cached && Date.now() - cached.at < CACHE_MS) render(cached);
  else {
    Promise.all([fetchMarketplace(), fetchReleases()])
      .then(([market, releases]) => {
        const data = { at: Date.now(), market, releases };
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch {
          /* ignorar */
        }
        render(data);
      })
      .catch(() => {
        if (cached) render(cached);
        else stats.hidden = true;
      });
  }
}
