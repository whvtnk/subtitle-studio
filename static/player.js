(function () {
  const video = document.getElementById("player");
  if (!video) return;

  const panel = document.getElementById("current-sub");
  const track = video.textTracks[0];
  const hasSpeech = "speechSynthesis" in window;
  let speakingMode = false;
  let queue = [];
  let busy = false;
  let lastQueued = null;

  const speechLang = (window.hciSpeechLang && window.hciSpeechLang(video.dataset.lang)) || "kk-KZ";
  if (track) track.mode = "showing"; // жергілікті субтитр толық экранда да көрінеді; панель — үлкен көшірме

  function cueAtNow() {
    if (!track || !track.cues) return null;
    const t = video.currentTime;
    for (const c of track.cues) {
      if (t >= c.startTime && t < c.endTime) return c;
    }
    return null;
  }

  // Оқуды толық тоқтату: очередь тазаланады, ағымдағы сөйлеу үзіледі
  function clearSpeech() {
    queue = [];
    busy = false;
    lastQueued = null;
    if (hasSpeech) speechSynthesis.cancel();
  }

  // Строканы очередьге қосу (ағымдағы оқу үзілмейді)
  function enqueue(cue) {
    if (!speakingMode || !cue || cue === lastQueued) return;
    lastQueued = cue;
    queue.push(cue);
    pump();
  }

  function pump() {
    if (busy || !speakingMode || queue.length === 0) return;
    const cue = queue.shift();
    if (video.currentTime >= cue.endTime) return pump(); // өтіп кеткен строка оқылмайды

    // Строка экранда тұрғанша үлгеретіндей жылдамдық
    const dur = Math.max(cue.endTime - Math.max(cue.startTime, video.currentTime), 0.5);
    const rate = Math.min(2, Math.max(0.8, (cue.text.length / 13) / dur));

    busy = true;
    const u = new SpeechSynthesisUtterance(cue.text);
    u.lang = speechLang;
    u.rate = rate;
    const finish = function () { busy = false; pump(); };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  }

  function setMode(mode) {
    clearSpeech();
    speakingMode = mode === "tts" && hasSpeech;
    video.muted = speakingMode; // дауыспен оқу кезінде түпнұсқа дыбыс өшеді
    if (speakingMode && !video.paused) enqueue(cueAtNow());
  }

  document.querySelectorAll('input[name="sound"]').forEach(function (radio) {
    radio.addEventListener("change", function () { setMode(radio.value); });
  });

  if (track) {
    track.addEventListener("cuechange", function () {
      const cue = track.activeCues && track.activeCues[0];
      panel.textContent = cue ? cue.text : "";
      if (speakingMode && cue && !video.paused) enqueue(cue);
    });
  }

  video.addEventListener("play", function () { if (speakingMode) enqueue(cueAtNow()); });
  video.addEventListener("pause", clearSpeech);
  video.addEventListener("ended", clearSpeech);
  video.addEventListener("seeking", clearSpeech);
  video.addEventListener("seeked", function () {
    if (speakingMode && !video.paused) enqueue(cueAtNow());
  });
})();
