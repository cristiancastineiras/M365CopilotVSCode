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
