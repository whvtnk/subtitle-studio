(function () {
  const log = document.getElementById("chat-log");
  if (!log) return;
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const clear = document.getElementById("chat-clear");
  const imageIn = document.getElementById("chat-image");
  const fileRow = document.getElementById("chat-file-row");
  const fileName = document.getElementById("chat-file-name");
  const fileClear = document.getElementById("chat-file-clear");
  const hasSpeech = "speechSynthesis" in window;
  const MAX_BYTES = 4 * 1024 * 1024;
  let file = null;

  function emptyState() {
    if (log.children.length) return;
    const p = document.createElement("p");
    p.className = "chat-empty muted";
    p.textContent = "Сәлем! Субтитр, бейне немесе сайт туралы сұрағыңызды жазыңыз, не сурет қосыңыз.";
    log.append(p);
  }

  // Жауапты дауыстап оқу батырмасы бар хабарлама көпіршігі
  function bubble(cls, text) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.textContent = text;
    if (cls === "assistant" && hasSpeech) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "speak";
      btn.setAttribute("aria-label", "Жауапты дауыспен оқу");
      btn.title = "Дауыспен оқу";
      btn.textContent = "🔊";
      btn.addEventListener("click", function () {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = window.hciSpeechLang(null, text);
        u.rate = 0.95;
        speechSynthesis.speak(u);
      });
      d.append(btn);
    }
    log.append(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function clearFile() {
    file = null;
    imageIn.value = "";
    fileRow.hidden = true;
    fileName.textContent = "";
  }

  imageIn.addEventListener("change", function () {
    const f = imageIn.files[0];
    if (!f) return clearFile();
    if (f.size > MAX_BYTES) {
      clearFile();
      bubble("error", "Сурет 4 МБ-тан үлкен болмауы керек.");
      return;
    }
    file = f;
    fileName.textContent = "🖼 " + f.name;
    fileRow.hidden = false;
    input.focus();
  });
  fileClear.addEventListener("click", clearFile);
  document.getElementById("chat-attach").addEventListener("click", function () { imageIn.click(); });

  async function loadHistory() {
    try {
      const r = await fetch("/api/chat");
      if (!r.ok) throw new Error();
      const rows = await r.json();
      log.innerHTML = "";
      rows.forEach(function (m) { bubble(m.role, m.content); });
    } catch (e) {
      log.innerHTML = "";
    }
    emptyState();
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !file) return;
    const shown = file ? "🖼 " + file.name + (text ? "\n" + text : "") : text;
    const sentFile = file;
    input.value = "";
    clearFile();
    log.querySelector(".chat-empty")?.remove();
    bubble("user", shown);
    const typing = bubble("assistant typing", "•••");
    typing.setAttribute("aria-hidden", "true");
    send.disabled = true;
    try {
      let r;
      if (sentFile) {
        const fd = new FormData();
        fd.append("image", sentFile);
        fd.append("question", text);
        r = await fetch("/api/describe", { method: "POST", body: fd });
      } else {
        r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text })
        });
      }
      const d = await r.json();
      typing.remove();
      bubble(r.ok ? "assistant" : "error", r.ok ? d.reply : d.error);
    } catch (err) {
      typing.remove();
      bubble("error", "Байланыс қатесі. Қайта көріңіз.");
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  clear.addEventListener("click", async function () {
    try { await fetch("/api/chat", { method: "DELETE" }); } catch (e) {}
    log.innerHTML = "";
    emptyState();
  });

  loadHistory();
})();
