(function () {
  const root = document.documentElement;
  const body = document.body;

  // Сақтау: қате болса да сайт жұмыс істейді (жеке режим, блокталған сақтау)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  const narrow = function () { return window.matchMedia("(max-width: 1100px)").matches; };
  const clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  // ---------- дизайн: тақырып ----------
  const DEFAULT = { accent: "#1c59d9", bg: "#f7f7f9", surface: "#ffffff", sidebar: "#efeff3", text: "#15171f", radius: 14, font: 18, contrast: false, motion: true };
  const PRESETS = {
    light: { accent: "#1c59d9", bg: "#f7f7f9", surface: "#ffffff", sidebar: "#efeff3", text: "#15171f" },
    dark:  { accent: "#7aa2ff", bg: "#0f1117", surface: "#171a23", sidebar: "#12141c", text: "#e8eaf2" },
    warm:  { accent: "#c2410c", bg: "#fbf7f2", surface: "#ffffff", sidebar: "#f3ebe0", text: "#2a2118" },
    green: { accent: "#0f766e", bg: "#f5faf8", surface: "#ffffff", sidebar: "#e6f2ee", text: "#10201c" }
  };

  // Контраст коэффициенті (WCAG): мәтін/фон жұбы үшін
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // Дауыстап оқу тілі: тіл коды немесе мәтіннің жазуы бойынша
  const SPEECH = { kk: "kk-KZ", ru: "ru-RU", en: "en-US" };
  window.hciSpeechLang = function (code, text) {
    if (code && SPEECH[code.slice(0, 2)]) return SPEECH[code.slice(0, 2)];
    if (text) {
      if (/[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/.test(text)) return "kk-KZ";
      if (/[а-яё]/i.test(text)) return "ru-RU";
      if (/[a-z]/i.test(text)) return "en-US";
    }
    return "kk-KZ";
  };

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [16, 8, 0].map(function (s) {
      const v = ((n >> s) & 255) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function applyTheme(t) {
    const s = root.style;
    s.setProperty("--accent", t.accent);
    s.setProperty("--on-accent", luminance(t.accent) > 0.179 ? "#111111" : "#ffffff");
    s.setProperty("--bg", t.bg);
    s.setProperty("--surface", t.surface);
    s.setProperty("--sidebar", t.sidebar);
    s.setProperty("--text", t.text);
    s.setProperty("--radius", t.radius + "px");
    s.fontSize = (t.font / 16 * 100) + "%";
    body.classList.toggle("contrast", !!t.contrast);
    body.classList.toggle("noanim", !t.motion);
  }

  let saved = clone(window.THEME || DEFAULT);
  let draft = clone(saved);
  applyTheme(saved);

  const dlg = document.getElementById("settings");
  const msg = document.getElementById("theme-msg");

  const warn = document.getElementById("theme-warn");
  function checkContrast() {
    const bad = [];
    if (contrast(draft.text, draft.bg) < 4.5) bad.push("мәтін мен фон");
    if (contrast(draft.text, draft.surface) < 4.5) bad.push("мәтін мен карточка");
    if (contrast(draft.text, draft.sidebar) < 4.5) bad.push("мәтін мен бүйірлік панель");
    if (contrast(draft.accent, draft.bg) < 4.5) bad.push("акцент пен фон");
    warn.textContent = !draft.contrast && bad.length ? "Назар аударыңыз: контраст аз (" + bad.join(", ") + "). Кемінде 4.5:1 болуы керек." : "";
  }

  function fillForm() {
    dlg.querySelectorAll("[data-key]").forEach(function (el) {
      const k = el.dataset.key;
      if (el.type === "checkbox") el.checked = !!draft[k];
      else el.value = draft[k];
      if (el.type === "range") el.parentElement.querySelector("output").textContent = el.value;
    });
  }

  dlg.querySelectorAll("[data-key]").forEach(function (el) {
    el.addEventListener("input", function () {
      const k = el.dataset.key;
      if (el.type === "checkbox") draft[k] = el.checked;
      else if (el.type === "range") draft[k] = Number(el.value);
      else draft[k] = el.value;
      if (el.type === "range") el.parentElement.querySelector("output").textContent = el.value;
      applyTheme(draft);
      checkContrast();
      msg.textContent = "";
    });
  });

  dlg.querySelectorAll("[data-preset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      draft = Object.assign(clone(draft), PRESETS[btn.dataset.preset]);
      fillForm();
      applyTheme(draft);
      checkContrast();
      msg.textContent = "";
    });
  });

  document.getElementById("open-settings").addEventListener("click", function () {
    draft = clone(saved);
    fillForm();
    checkContrast();
    msg.textContent = "";
    dlg.showModal();
  });

  function closeSettings() {
    applyTheme(saved); // сақталмаған өзгерісті қайтару
    dlg.close();
  }
  document.getElementById("settings-close").addEventListener("click", closeSettings);
  dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeSettings(); });

  document.getElementById("theme-reset").addEventListener("click", function () {
    draft = clone(DEFAULT);
    fillForm();
    applyTheme(draft);
    checkContrast();
    msg.textContent = "Әдепкі баптау қойылды. «Сақтау» басыңыз.";
  });

  document.getElementById("theme-save").addEventListener("click", async function () {
    msg.textContent = "Сақталуда…";
    try {
      const r = await fetch("/api/theme", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      if (!r.ok) throw new Error();
      saved = await r.json();
      applyTheme(saved);
      msg.textContent = "Сақталды ✓";
    } catch (e) {
      msg.textContent = "Сақтау мүмкін болмады. Интернетті тексеріңіз.";
    }
  });

  // ---------- сайдбар және ЖИ чаты: жию / жазу ----------
  const sbToggle = document.getElementById("sb-toggle");
  const chatToggle = document.getElementById("chat-toggle");
  const scrim = document.getElementById("scrim");

  function updateScrim() {
    const open = !body.classList.contains("sb-closed") || !body.classList.contains("chat-closed");
    scrim.hidden = !(narrow() && open);
  }

  // Тар экранда панель ашылса фокус ішке өтеді, жабылса түймеге қайтады
  function focusLater(el) { setTimeout(function () { if (el) el.focus(); }, 60); }

  let interactive = false;

  function setSidebar(open, remember) {
    body.classList.toggle("sb-closed", !open);
    if (open && narrow()) body.classList.add("chat-closed"); // кішкене экранда бір уақытта біреуі ашық
    sbToggle.setAttribute("aria-expanded", String(open));
    updateScrim();
    if (remember !== false) store.set("hci-sidebar", open);
    if (narrow() && interactive) focusLater(open ? search : sbToggle);
  }

  function setChat(open, remember) {
    body.classList.toggle("chat-closed", !open);
    if (open && narrow()) body.classList.add("sb-closed");
    chatToggle.setAttribute("aria-expanded", String(open));
    updateScrim();
    if (remember !== false) store.set("hci-chat", open);
    if (narrow() && interactive) focusLater(open ? document.getElementById("chat-input") : chatToggle);
  }

  const sbSaved = store.get("hci-sidebar", null);
  const chSaved = store.get("hci-chat", null);
  body.classList.toggle("sb-closed", !(sbSaved === null ? !narrow() : sbSaved));
  body.classList.toggle("chat-closed", !(chSaved === null ? !narrow() : chSaved));
  sbToggle.setAttribute("aria-expanded", String(!body.classList.contains("sb-closed")));
  chatToggle.setAttribute("aria-expanded", String(!body.classList.contains("chat-closed")));
  updateScrim();

  // Фокусты тек пайдаланушы әрекетінен кейін ғана жылжытамыз
  function act(fn) { interactive = true; try { fn(); } finally { interactive = false; } }
  sbToggle.addEventListener("click", function () { act(function () { setSidebar(body.classList.contains("sb-closed")); }); });
  chatToggle.addEventListener("click", function () { act(function () { setChat(body.classList.contains("chat-closed")); }); });
  document.getElementById("chat-close").addEventListener("click", function () { act(function () { setChat(false); }); });
  scrim.addEventListener("click", function () { act(function () { setSidebar(false); setChat(false); }); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !narrow() || dlg.open) return;
    const sbOpen = !body.classList.contains("sb-closed");
    const chOpen = !body.classList.contains("chat-closed");
    if (!sbOpen && !chOpen) return;
    act(function () {
      setSidebar(false);
      setChat(false);
      focusLater(sbOpen ? sbToggle : chatToggle);
    });
  });
  // Кішкене экранда сілтемені басқанда мәзір жабылады
  document.getElementById("sidebar").addEventListener("click", function (e) {
    if (narrow() && e.target.closest("a")) setSidebar(false);
  });

  // ---------- сайдбар: жұмыстар тізімі + ізденіс ----------
  const list = document.getElementById("sb-list");
  const empty = document.getElementById("sb-empty");
  const search = document.getElementById("sb-search");
  let items = [];

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter(function (v) { return v.title.toLowerCase().includes(q); });
    list.innerHTML = "";
    shown.forEach(function (v) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "sb-item";
      a.href = "/player/" + v.job + "/" + v.ext;
      if (location.pathname === "/player/" + v.job + "/" + v.ext) a.setAttribute("aria-current", "page");
      const t = document.createElement("span");
      t.textContent = v.title;
      const d = document.createElement("small");
      d.textContent = v.label;
      a.append(t, d);
      li.append(a);
      list.append(li);
    });
    empty.hidden = shown.length > 0;
    empty.textContent = items.length ? "Табылмады" : "Әлі жұмыс жоқ";
  }

  search.addEventListener("input", renderList);
  fetch("/api/videos")
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (data) { items = data; renderList(); })
    .catch(function () { renderList(); });

  // ---------- жүктеу формасы: сүйреп тастау, батырманы бір рет басу ----------
  const input = document.getElementById("video-input");
  if (input) {
    const form = document.getElementById("upload-form");
    const dz = document.getElementById("dropzone");
    const dzTitle = document.getElementById("dz-title");
    const submit = document.getElementById("submit-btn");
    const pick = function () {
      if (!input.files.length) return;
      dzTitle.textContent = input.files[0].name;
      dz.classList.add("has-file");
      submit.disabled = false;
    };
    input.addEventListener("change", pick);
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("over"); });
    });
    dz.addEventListener("drop", function (e) {
      if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; pick(); }
    });
    form.addEventListener("submit", function () {
      submit.disabled = true;
      submit.textContent = "Жүктелуде…";
    });
  }
  // ---------- сурет сипаттау (басты бет) ----------
  const imgInput = document.getElementById("img-input");
  if (imgInput) {
    const dform = document.getElementById("describe-form");
    const imgTitle = document.getElementById("img-title");
    const imgBtn = document.getElementById("describe-btn");
    const out = document.getElementById("describe-result");
    const MAX_IMG = 4 * 1024 * 1024;

    function speak(text) {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = window.hciSpeechLang(null, text);
      u.rate = 0.95;
      speechSynthesis.speak(u);
    }

    imgInput.addEventListener("change", function () {
      const f = imgInput.files[0];
      out.textContent = "";
      if (!f) { imgBtn.disabled = true; return; }
      if (f.size > MAX_IMG) {
        out.textContent = "Сурет 4 МБ-тан үлкен болмауы керек.";
        imgInput.value = "";
        imgBtn.disabled = true;
        return;
      }
      imgTitle.textContent = "🖼 " + f.name;
      imgBtn.disabled = false;
    });

    dform.addEventListener("submit", async function (e) {
      e.preventDefault();
      imgBtn.disabled = true;
      imgBtn.textContent = "Сипатталуда…";
      out.textContent = "";
      try {
        const r = await fetch("/api/describe", { method: "POST", body: new FormData(dform) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Қате шықты.");
        const wrap = document.createElement("div");
        wrap.className = "msg assistant";
        wrap.textContent = d.reply;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "speak";
        btn.setAttribute("aria-label", "Сипаттаманы дауыспен оқу");
        btn.textContent = "🔊";
        btn.addEventListener("click", function () { speak(d.reply); });
        wrap.append(btn);
        out.append(wrap);
      } catch (err) {
        out.textContent = err.message || "Байланыс қатесі. Қайта көріңіз.";
      } finally {
        imgBtn.disabled = !imgInput.files.length;
        imgBtn.textContent = "Сипаттау";
      }
    });
  }

})();
