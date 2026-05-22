(() => {
  const $ = (id) => document.getElementById(id);

  const textEl = $("text");
  const charCount = $("char-count");
  const speedEl = $("speed");
  const speedVal = $("speed-val");
  const generateBtn = $("generate");
  const downloadBtn = $("download");
  const audioEl = $("audio");
  const playerEl = $("player");
  const metaEl = $("meta");
  const statusEl = $("status");
  const statusText = $("status-text");
  const libraryEl = $("library");
  const categoriesEl = $("categories");
  const searchEl = $("search");
  const toastEl = $("toast");
  const themeToggle = $("theme-toggle");
  const themeLink = document.getElementById("theme-link");

  let currentAudioUrl = null;
  let currentFilename = null;
  let activeCategory = "All";
  let searchQuery = "";

  // ---- theme toggle ----
  const THEMES = {
    studio: "/static/style.css",
    classic: "/static/style-classic.css",
  };
  const applyTheme = (name) => {
    const href = THEMES[name] || THEMES.studio;
    themeLink.href = href;
    themeToggle.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === name);
    });
    try { localStorage.setItem("theme", name); } catch {}
  };
  themeToggle.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => applyTheme(b.dataset.theme));
  });
  try {
    const saved = localStorage.getItem("theme");
    if (saved && THEMES[saved]) applyTheme(saved);
  } catch {}

  // ---- char count ----
  const updateCount = () => {
    charCount.textContent = textEl.value.length;
  };
  textEl.addEventListener("input", updateCount);

  // ---- speed slider ----
  speedEl.addEventListener("input", () => {
    speedVal.textContent = `${parseFloat(speedEl.value).toFixed(2)}×`;
  });

  // ---- toast ----
  let toastTimeout;
  const toast = (msg, type = "") => {
    toastEl.textContent = msg;
    toastEl.className = `toast show ${type}`;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2400);
  };

  // ---- library rendering ----
  const renderCategories = () => {
    const cats = ["All", ...new Set(window.TEXT_LIBRARY.map((x) => x.category))];
    categoriesEl.innerHTML = cats
      .map(
        (c) =>
          `<button class="cat-btn ${c === activeCategory ? "active" : ""}" data-cat="${c}">${c}</button>`
      )
      .join("");
    categoriesEl.querySelectorAll(".cat-btn").forEach((b) => {
      b.addEventListener("click", () => {
        activeCategory = b.dataset.cat;
        renderCategories();
        renderLibrary();
      });
    });
  };

  const renderLibrary = () => {
    const q = searchQuery.toLowerCase().trim();
    const items = window.TEXT_LIBRARY.filter((x) => {
      if (activeCategory !== "All" && x.category !== activeCategory) return false;
      if (q && !(x.title.toLowerCase().includes(q) || x.text.toLowerCase().includes(q))) return false;
      return true;
    });

    if (items.length === 0) {
      libraryEl.innerHTML = `<div class="empty">No matches.</div>`;
      return;
    }

    libraryEl.innerHTML = items
      .map(
        (item) => `
        <div class="lib-item" data-text="${encodeURIComponent(item.text)}">
          <div class="lib-item-meta">
            <span class="lib-title">${item.category} · ${item.title}</span>
            <div class="lib-actions">
              <button class="lib-action" data-action="copy">Copy</button>
              <button class="lib-action" data-action="use">Use</button>
            </div>
          </div>
          <p class="lib-text">${item.text}</p>
        </div>
      `
      )
      .join("");

    libraryEl.querySelectorAll(".lib-item").forEach((el) => {
      const text = decodeURIComponent(el.dataset.text);
      el.addEventListener("click", (e) => {
        const action = e.target?.dataset?.action;
        if (action === "copy") {
          e.stopPropagation();
          navigator.clipboard.writeText(text).then(() => toast("Copied to clipboard", "success"));
          return;
        }
        // default click or "Use" -> load into textarea
        textEl.value = text;
        updateCount();
        textEl.focus();
        toast("Loaded into editor", "success");
      });
    });
  };

  searchEl.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderLibrary();
  });

  // ---- generate ----
  const setLoading = (loading) => {
    generateBtn.disabled = loading;
    generateBtn.classList.toggle("loading", loading);
    generateBtn.querySelector(".btn-icon").textContent = loading ? "◐" : "▶";
    generateBtn.querySelector(".btn-label").textContent = loading ? "Generating" : "Generate";
  };

  const generate = async () => {
    const text = textEl.value.trim();
    if (!text) {
      toast("Enter some text first", "error");
      textEl.focus();
      return;
    }

    setLoading(true);
    metaEl.textContent = "";

    try {
      const t0 = performance.now();
      const res = await fetch("/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          speed: parseFloat(speedEl.value),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Synthesis failed");

      const networkMs = Math.round(performance.now() - t0);
      currentAudioUrl = data.url;
      currentFilename = data.filename;
      audioEl.src = data.url + "?t=" + Date.now();
      playerEl.hidden = false;
      downloadBtn.disabled = false;

      metaEl.textContent = `synth ${data.elapsed_ms}ms · total ${networkMs}ms`;

      // auto-play
      audioEl.play().catch(() => {
        toast("Tap play to listen", "");
      });
    } catch (err) {
      toast(err.message || "Error", "error");
    } finally {
      setLoading(false);
    }
  };

  generateBtn.addEventListener("click", generate);

  // Cmd/Ctrl+Enter to generate
  textEl.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });

  // ---- download ----
  downloadBtn.addEventListener("click", () => {
    if (!currentAudioUrl) return;
    const a = document.createElement("a");
    a.href = currentAudioUrl;
    a.download = currentFilename || "tinytts.wav";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  // ---- status check ----
  const checkStatus = async () => {
    try {
      const res = await fetch("/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }),
      });
      // We expect 400 "Empty text" once the server is alive
      if (res.status === 400 || res.ok) {
        statusEl.classList.add("ready");
        statusText.textContent = "Model ready";
      }
    } catch {
      statusEl.classList.add("error");
      statusText.textContent = "Server unreachable";
    }
  };

  // =============================================================
  // Camera narration: capture frame -> /describe -> speak -> wait 5s
  // =============================================================
  const camVideo = $("cam-video");
  const camCanvas = $("cam-canvas");
  const camOverlay = $("cam-overlay");
  const camStart = $("cam-start");
  const camStatus = $("cam-status");
  const camAudio = $("cam-audio");
  const camVoice = $("cam-voice");
  const camTiming = $("cam-timing");
  const capRu = $("cap-ru");
  const capEn = $("cap-en");
  const videoWrap = camVideo.parentElement;

  let camStream = null;
  let camRunning = false;
  let camCycleId = 0; // bumps on stop to cancel pending awaits

  const WAIT_AFTER_AUDIO_MS = 5000;

  const setCamStatus = (state, label) => {
    camStatus.dataset.state = state;
    camStatus.textContent = label;
  };

  const sleep = (ms, id) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        if (id !== camCycleId) return reject(new Error("cancelled"));
        resolve();
      }, ms);
      // best-effort: leak timer if cancelled — id check protects logic
      sleep._t = t;
    });

  const captureFrame = () =>
    new Promise((resolve, reject) => {
      const w = camVideo.videoWidth;
      const h = camVideo.videoHeight;
      if (!w || !h) return reject(new Error("video not ready"));
      camCanvas.width = w;
      camCanvas.height = h;
      const ctx = camCanvas.getContext("2d");
      ctx.drawImage(camVideo, 0, 0, w, h);
      const dataUrl = camCanvas.toDataURL("image/jpeg", 0.82);
      resolve(dataUrl);
    });

  const waitAudioEnded = (id) =>
    new Promise((resolve, reject) => {
      const onEnd = () => {
        camAudio.removeEventListener("ended", onEnd);
        camAudio.removeEventListener("error", onErr);
        if (id !== camCycleId) return reject(new Error("cancelled"));
        resolve();
      };
      const onErr = () => {
        camAudio.removeEventListener("ended", onEnd);
        camAudio.removeEventListener("error", onErr);
        reject(new Error("audio error"));
      };
      camAudio.addEventListener("ended", onEnd, { once: true });
      camAudio.addEventListener("error", onErr, { once: true });
    });

  const cycleOnce = async (id) => {
    if (id !== camCycleId) return false;

    setCamStatus("capture", "capture");
    let dataUrl;
    try {
      dataUrl = await captureFrame();
    } catch (e) {
      throw new Error("Camera frame unavailable");
    }
    if (id !== camCycleId) return false;

    setCamStatus("describe", "describe");
    const t0 = performance.now();
    const res = await fetch("/describe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, voice: camVoice.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "describe failed");
    if (id !== camCycleId) return false;

    const networkMs = Math.round(performance.now() - t0);
    capRu.textContent = data.ru || "—";
    capEn.textContent = data.en || "—";
    const t = data.timings || {};
    camTiming.textContent = `blip ${t.blip_ms}ms · tr ${t.translate_ms}ms · silero ${t.silero_ms}ms · total ${networkMs}ms`;

    setCamStatus("speak", "speak");
    camAudio.src = data.url + "?t=" + Date.now();
    try {
      await camAudio.play();
    } catch (e) {
      // Autoplay may be blocked until user gesture; first click already gave us that.
    }
    await waitAudioEnded(id);
    if (id !== camCycleId) return false;

    setCamStatus("wait", `wait 5s`);
    await sleep(WAIT_AFTER_AUDIO_MS, id);
    return id === camCycleId;
  };

  const runCameraLoop = async () => {
    const id = ++camCycleId;
    camRunning = true;
    camStart.dataset.running = "true";
    camStart.querySelector(".btn-label").textContent = "Stop";
    camStart.querySelector(".btn-icon").textContent = "■";

    try {
      while (camRunning && id === camCycleId) {
        const cont = await cycleOnce(id);
        if (!cont) break;
      }
    } catch (e) {
      if (e && e.message !== "cancelled") {
        setCamStatus("error", "error");
        toast(e.message, "error");
      }
    }
  };

  const stopCamera = () => {
    camRunning = false;
    camCycleId++;
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
    }
    camVideo.srcObject = null;
    videoWrap.classList.remove("live");
    camOverlay.textContent = "camera off";
    setCamStatus("idle", "idle");
    camStart.dataset.running = "false";
    camStart.querySelector(".btn-label").textContent = "Start camera";
    camStart.querySelector(".btn-icon").textContent = "●";
    try { camAudio.pause(); } catch {}
  };

  const startCamera = async () => {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      camVideo.srcObject = camStream;
      await new Promise((r) => {
        if (camVideo.readyState >= 2) return r();
        camVideo.addEventListener("loadeddata", r, { once: true });
      });
      videoWrap.classList.add("live");
      camOverlay.textContent = "";
      runCameraLoop();
    } catch (e) {
      toast(`Camera access denied: ${e.message}`, "error");
      setCamStatus("error", "error");
    }
  };

  camStart.addEventListener("click", () => {
    if (camRunning) stopCamera();
    else startCamera();
  });

  // Stop camera when leaving page
  window.addEventListener("beforeunload", () => {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
  });

  // ---- init ----
  renderCategories();
  renderLibrary();
  updateCount();
  checkStatus();
  setCamStatus("idle", "idle");
  // Re-check after 5s in case model is still loading
  setTimeout(checkStatus, 5000);
})();
