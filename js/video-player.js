// ==========================================================================
// video-player.js — Custom modern video player skin.
//
// Replaces the old bare `<video controls>` element and the plain YouTube
// `<iframe>` with one consistent, custom-built player: gradient control bar,
// scrubbable progress bar with a buffered-range indicator, volume slider,
// playback-speed menu, fullscreen + picture-in-picture, keyboard shortcuts
// (space/←/→/↑/↓/f/m), and double-tap-to-seek on touch devices.
//
// A direct video file and a YouTube lesson are wrapped behind the exact same
// adapter interface (play/pause/seek/getCurrentTime/getDuration/on(...)), so
// every control in the skin is wired up once and works identically for both
// — the calling code never has to branch on the source type.
//
// Usage (see js/course.js):
//   const ctl = createVideoPlayer(containerEl, { type: "file", url }, {
//     onReady(duration) {},
//     onTimeUpdate(currentTime, duration) {},
//     onPause(currentTime, duration) {},
//     onEnded() {},
//   });
//   ctl.seek(30); ctl.getCurrentTime(); ctl.getDuration(); ctl.destroy();
//
// source is one of:
//   { type: "file", url }       — direct mp4/webm/ogg or any hosted file
//   { type: "youtube", yid }    — YouTube video id
//   { type: "empty", message }  — nothing to play, just show a message
// ==========================================================================

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SEEK_STEP = 10; // seconds, for the rewind/forward buttons + double-tap
const ARROW_SEEK_STEP = 5; // seconds, for the ←/→ keyboard shortcuts
const VOLUME_STORAGE_KEY = "tvc-video-volume";
const MUTED_STORAGE_KEY = "tvc-video-muted";

let ytApiPromise = null;
function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevReady === "function") prevReady();
      resolve(window.YT);
    };
    if (!document.getElementById("yt-iframe-api-script")) {
      const tag = document.createElement("script");
      tag.id = "yt-iframe-api-script";
      tag.src = "https://www.youtube.com/iframe_api";
      tag.onerror = () => reject(new Error("Failed to load YouTube IFrame API"));
      document.head.appendChild(tag);
    }
    // Bail out after 10s rather than hanging forever offline/blocked.
    setTimeout(() => reject(new Error("YouTube IFrame API load timeout")), 10000);
  });
  return ytApiPromise;
}

function formatClock(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  totalSeconds = Math.floor(totalSeconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getStoredVolume() {
  const v = parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
}
function getStoredMuted() {
  return localStorage.getItem(MUTED_STORAGE_KEY) === "1";
}

/* ---------- Adapter: wraps a native <video> element ---------- */
function createNativeAdapter(videoEl) {
  const listeners = {};
  const emit = (evt, ...args) => (listeners[evt] || []).forEach((fn) => fn(...args));
  videoEl.addEventListener("loadedmetadata", () => emit("ready", videoEl.duration));
  videoEl.addEventListener("timeupdate", () => emit("timeupdate", videoEl.currentTime, videoEl.duration));
  videoEl.addEventListener("progress", () => emit("progress"));
  videoEl.addEventListener("play", () => emit("play"));
  videoEl.addEventListener("playing", () => emit("playing"));
  videoEl.addEventListener("pause", () => emit("pause", videoEl.currentTime, videoEl.duration));
  videoEl.addEventListener("ended", () => emit("ended"));
  videoEl.addEventListener("waiting", () => emit("waiting"));
  videoEl.addEventListener("volumechange", () => emit("volumechange", videoEl.muted ? 0 : videoEl.volume, videoEl.muted));
  videoEl.addEventListener("error", () => emit("error"));

  return {
    on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
    play: () => videoEl.play().catch(() => {}),
    pause: () => videoEl.pause(),
    isPaused: () => videoEl.paused,
    seek: (t) => { videoEl.currentTime = Math.max(0, t); },
    getCurrentTime: () => videoEl.currentTime || 0,
    getDuration: () => videoEl.duration || 0,
    getBufferedEnd: () => {
      try { return videoEl.buffered.length ? videoEl.buffered.end(videoEl.buffered.length - 1) : 0; }
      catch { return 0; }
    },
    setVolume: (v) => { videoEl.volume = v; if (v > 0) videoEl.muted = false; },
    getVolume: () => (videoEl.muted ? 0 : videoEl.volume),
    toggleMute: () => { videoEl.muted = !videoEl.muted; },
    isMuted: () => videoEl.muted,
    setPlaybackRate: (r) => { videoEl.playbackRate = r; },
    supportsPiP: document.pictureInPictureEnabled && !videoEl.disablePictureInPicture,
    requestPiP: () => videoEl.requestPictureInPicture?.().catch(() => {}),
    destroy: () => { videoEl.pause(); videoEl.removeAttribute("src"); videoEl.load(); },
  };
}

/* ---------- Adapter: wraps a YT.Player (scriptable IFrame API) ---------- */
function createYouTubeAdapter(player, YT) {
  const listeners = {};
  const emit = (evt, ...args) => (listeners[evt] || []).forEach((fn) => fn(...args));
  let pollId = null;
  const startPoll = () => {
    stopPoll();
    pollId = setInterval(() => emit("timeupdate", player.getCurrentTime?.() || 0, player.getDuration?.() || 0), 250);
  };
  const stopPoll = () => { if (pollId) { clearInterval(pollId); pollId = null; } };

  player.addEventListener("onStateChange", (e) => {
    if (e.data === YT.PlayerState.PLAYING) { emit("playing"); emit("play"); startPoll(); }
    else if (e.data === YT.PlayerState.PAUSED) { emit("pause", player.getCurrentTime?.() || 0, player.getDuration?.() || 0); stopPoll(); }
    else if (e.data === YT.PlayerState.ENDED) { emit("ended"); stopPoll(); }
    else if (e.data === YT.PlayerState.BUFFERING) { emit("waiting"); }
  });
  player.addEventListener("onError", () => emit("error"));

  return {
    on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
    play: () => player.playVideo?.(),
    pause: () => player.pauseVideo?.(),
    isPaused: () => { try { return player.getPlayerState?.() !== YT.PlayerState.PLAYING; } catch { return true; } },
    seek: (t) => player.seekTo?.(Math.max(0, t), true),
    getCurrentTime: () => { try { return player.getCurrentTime?.() || 0; } catch { return 0; } },
    getDuration: () => { try { return player.getDuration?.() || 0; } catch { return 0; } },
    getBufferedEnd: () => { try { return (player.getVideoLoadedFraction?.() || 0) * (player.getDuration?.() || 0); } catch { return 0; } },
    setVolume: (v) => { try { player.setVolume?.(Math.round(v * 100)); if (v > 0) player.unMute?.(); } catch {} },
    getVolume: () => { try { return player.isMuted?.() ? 0 : (player.getVolume?.() ?? 100) / 100; } catch { return 1; } },
    toggleMute: () => { try { player.isMuted?.() ? player.unMute?.() : player.mute?.(); } catch {} },
    isMuted: () => { try { return !!player.isMuted?.(); } catch { return false; } },
    setPlaybackRate: (r) => { try { player.setPlaybackRate?.(r); } catch {} },
    supportsPiP: false,
    requestPiP: () => {},
    destroy: () => { stopPoll(); try { player.destroy?.(); } catch {} },
  };
}

const SKIN_HTML = `
  <div class="cvp-media-wrap"></div>
  <div class="cvp-click-catcher"></div>
  <div class="cvp-tap-zones"><div class="cvp-tap-left"></div><div class="cvp-tap-right"></div></div>
  <div class="cvp-seek-flash cvp-seek-flash-left"><i class="fa-solid fa-backward"></i><span>${SEEK_STEP}s</span></div>
  <div class="cvp-seek-flash cvp-seek-flash-right"><i class="fa-solid fa-forward"></i><span>${SEEK_STEP}s</span></div>
  <div class="cvp-center-overlay">
    <div class="cvp-spinner"><span class="spinner"></span></div>
    <button type="button" class="cvp-big-play" aria-label="Play"><i class="fa-solid fa-play"></i></button>
  </div>
  <div class="cvp-controls">
    <div class="cvp-progress" role="slider" tabindex="0" aria-label="Seek">
      <div class="cvp-progress-track">
        <div class="cvp-progress-buffered"></div>
        <div class="cvp-progress-played"></div>
      </div>
      <div class="cvp-progress-thumb"></div>
    </div>
    <div class="cvp-row">
      <button type="button" class="cvp-btn cvp-play-btn" aria-label="Play/Pause"><i class="fa-solid fa-play"></i></button>
      <button type="button" class="cvp-btn cvp-rewind-btn" aria-label="Rewind 10 seconds"><i class="fa-solid fa-rotate-left"></i></button>
      <button type="button" class="cvp-btn cvp-forward-btn" aria-label="Forward 10 seconds"><i class="fa-solid fa-rotate-right"></i></button>
      <div class="cvp-volume">
        <button type="button" class="cvp-btn cvp-mute-btn" aria-label="Mute/Unmute"><i class="fa-solid fa-volume-high"></i></button>
        <input type="range" class="cvp-vol-range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
      </div>
      <span class="cvp-time"><span class="cvp-time-current">0:00</span> / <span class="cvp-time-duration">0:00</span></span>
      <div class="cvp-spacer"></div>
      <div class="cvp-speed">
        <button type="button" class="cvp-btn cvp-speed-btn" aria-label="Playback speed">1x</button>
        <div class="cvp-speed-menu"></div>
      </div>
      <button type="button" class="cvp-btn cvp-pip-btn" aria-label="Picture in picture"><i class="fa-regular fa-clone"></i></button>
      <button type="button" class="cvp-btn cvp-fullscreen-btn" aria-label="Fullscreen"><i class="fa-solid fa-expand"></i></button>
    </div>
  </div>
`;

function escapeAttr(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function showErrorState(container, url) {
  container.innerHTML = url
    ? `<div class="slide-empty" style="width:100%">This video link couldn't be played here. <a href="${escapeAttr(url)}" target="_blank" rel="noopener">Open the video directly</a></div>`
    : `<div class="slide-empty" style="width:100%">No video has been added to this lesson yet</div>`;
}

/* ---------- Main entry point ---------- */
export function createVideoPlayer(container, source, callbacks = {}) {
  if (!source || source.type === "empty" || (source.type === "file" && !source.url) || (source.type === "youtube" && !source.yid)) {
    container.innerHTML = `<div class="slide-empty" style="width:100%">${source?.message || "No video has been added to this lesson yet"}</div>`;
    return { seek() {}, getCurrentTime: () => 0, getDuration: () => 0, destroy() {} };
  }

  container.classList.add("video-frame");
  container.innerHTML = "";
  const root = document.createElement("div");
  root.className = "cvp cvp-controls-hidden cvp-paused";
  root.tabIndex = 0;
  root.innerHTML = SKIN_HTML;
  container.appendChild(root);

  const mediaWrap = root.querySelector(".cvp-media-wrap");
  const clickCatcher = root.querySelector(".cvp-click-catcher");
  const bigPlay = root.querySelector(".cvp-big-play");
  const spinner = root.querySelector(".cvp-spinner");
  const controls = root.querySelector(".cvp-controls");
  const progress = root.querySelector(".cvp-progress");
  const progressBuffered = root.querySelector(".cvp-progress-buffered");
  const progressPlayed = root.querySelector(".cvp-progress-played");
  const progressThumb = root.querySelector(".cvp-progress-thumb");
  const playBtn = root.querySelector(".cvp-play-btn");
  const rewindBtn = root.querySelector(".cvp-rewind-btn");
  const forwardBtn = root.querySelector(".cvp-forward-btn");
  const volumeWrap = root.querySelector(".cvp-volume");
  const muteBtn = root.querySelector(".cvp-mute-btn");
  const volRange = root.querySelector(".cvp-vol-range");
  const timeCurrent = root.querySelector(".cvp-time-current");
  const timeDuration = root.querySelector(".cvp-time-duration");
  const speedWrap = root.querySelector(".cvp-speed");
  const speedBtn = root.querySelector(".cvp-speed-btn");
  const speedMenu = root.querySelector(".cvp-speed-menu");
  const pipBtn = root.querySelector(".cvp-pip-btn");
  const fullscreenBtn = root.querySelector(".cvp-fullscreen-btn");
  const flashLeft = root.querySelector(".cvp-seek-flash-left");
  const flashRight = root.querySelector(".cvp-seek-flash-right");
  const tapLeft = root.querySelector(".cvp-tap-left");
  const tapRight = root.querySelector(".cvp-tap-right");

  speedMenu.innerHTML = SPEED_OPTIONS.map(
    (s) => `<button type="button" class="cvp-speed-option${s === 1 ? " cvp-active" : ""}" data-speed="${s}">${s}x</button>`
  ).join("");

  let adapter = null;
  let destroyed = false;
  let knownDuration = 0;
  let hideTimer = null;
  let dragging = false;

  function playPauseIcon(paused) {
    const icon = paused ? "fa-play" : "fa-pause";
    playBtn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    bigPlay.innerHTML = `<i class="fa-solid ${icon === "fa-play" ? "fa-play" : "fa-pause"}"></i>`;
    bigPlay.classList.toggle("cvp-hidden", !paused);
    root.classList.toggle("cvp-paused", paused);
  }

  function updateVolumeIcon(vol, muted) {
    let icon = "fa-volume-high";
    if (muted || vol === 0) icon = "fa-volume-xmark";
    else if (vol < 0.5) icon = "fa-volume-low";
    muteBtn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    volRange.value = muted ? 0 : vol;
  }

  function updateProgress(current, duration) {
    if (dragging) return;
    const d = duration || knownDuration || 0;
    const pct = d > 0 ? Math.min(100, (current / d) * 100) : 0;
    progressPlayed.style.width = pct + "%";
    progressThumb.style.left = pct + "%";
    timeCurrent.textContent = formatClock(current);
    if (d > 0) timeDuration.textContent = formatClock(d);
  }

  function updateBuffered() {
    const d = knownDuration || adapter?.getDuration() || 0;
    if (!d) return;
    const bufEnd = adapter?.getBufferedEnd() || 0;
    progressBuffered.style.width = Math.min(100, (bufEnd / d) * 100) + "%";
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (adapter && adapter.isPaused && adapter.isPaused()) return;
    hideTimer = setTimeout(() => root.classList.add("cvp-controls-hidden"), 2800);
  }
  function showControls() {
    root.classList.remove("cvp-controls-hidden");
    scheduleHide();
  }

  function flashSeek(el, direction) {
    el.classList.add("cvp-show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("cvp-show"), 550);
  }

  function seekBy(delta) {
    if (!adapter) return;
    const d = adapter.getDuration() || knownDuration || 0;
    const t = Math.max(0, Math.min(d || Infinity, adapter.getCurrentTime() + delta));
    adapter.seek(t);
    updateProgress(t, d);
  }

  function togglePlay() {
    if (!adapter) return;
    if (adapter.isPaused()) adapter.play(); else adapter.pause();
  }

  function setSpeed(rate) {
    adapter?.setPlaybackRate(rate);
    speedBtn.textContent = rate + "x";
    speedMenu.querySelectorAll(".cvp-speed-option").forEach((btn) => {
      btn.classList.toggle("cvp-active", parseFloat(btn.dataset.speed) === rate);
    });
    speedMenu.classList.remove("cvp-open");
  }

  function togglePiP() {
    if (!adapter?.supportsPiP) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else adapter.requestPiP();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen?.().catch(() => {});
  }
  document.addEventListener("fullscreenchange", () => {
    const isFs = document.fullscreenElement === root;
    fullscreenBtn.innerHTML = `<i class="fa-solid ${isFs ? "fa-compress" : "fa-expand"}"></i>`;
  });

  // ---- Progress bar scrubbing (mouse + touch) ----
  function pctFromEvent(e) {
    const rect = progress.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }
  function onProgressDown(e) {
    dragging = true;
    progress.classList.add("cvp-dragging");
    onProgressMove(e);
    window.addEventListener("mousemove", onProgressMove);
    window.addEventListener("touchmove", onProgressMove, { passive: true });
    window.addEventListener("mouseup", onProgressUp);
    window.addEventListener("touchend", onProgressUp);
  }
  function onProgressMove(e) {
    const d = adapter?.getDuration() || knownDuration || 0;
    const pct = pctFromEvent(e);
    progressPlayed.style.width = pct * 100 + "%";
    progressThumb.style.left = pct * 100 + "%";
    timeCurrent.textContent = formatClock(pct * d);
  }
  function onProgressUp(e) {
    const d = adapter?.getDuration() || knownDuration || 0;
    const pct = pctFromEvent(e);
    adapter?.seek(pct * d);
    dragging = false;
    progress.classList.remove("cvp-dragging");
    window.removeEventListener("mousemove", onProgressMove);
    window.removeEventListener("touchmove", onProgressMove);
    window.removeEventListener("mouseup", onProgressUp);
    window.removeEventListener("touchend", onProgressUp);
  }
  progress.addEventListener("mousedown", onProgressDown);
  progress.addEventListener("touchstart", onProgressDown, { passive: true });

  // ---- Buttons ----
  playBtn.addEventListener("click", togglePlay);
  bigPlay.addEventListener("click", togglePlay);
  clickCatcher.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); showControls(); });
  rewindBtn.addEventListener("click", () => { seekBy(-SEEK_STEP); showControls(); });
  forwardBtn.addEventListener("click", () => { seekBy(SEEK_STEP); showControls(); });
  muteBtn.addEventListener("click", () => {
    adapter?.toggleMute();
    const muted = adapter?.isMuted();
    localStorage.setItem(MUTED_STORAGE_KEY, muted ? "1" : "0");
    updateVolumeIcon(adapter?.getVolume() ?? 1, muted);
  });
  volRange.addEventListener("input", () => {
    const v = parseFloat(volRange.value);
    adapter?.setVolume(v);
    localStorage.setItem(VOLUME_STORAGE_KEY, String(v));
    localStorage.setItem(MUTED_STORAGE_KEY, v === 0 ? "1" : "0");
    updateVolumeIcon(v, v === 0);
  });
  volumeWrap.addEventListener("mouseenter", () => volumeWrap.classList.add("cvp-vol-active"));
  volumeWrap.addEventListener("mouseleave", () => volumeWrap.classList.remove("cvp-vol-active"));
  speedBtn.addEventListener("click", (e) => { e.stopPropagation(); speedMenu.classList.toggle("cvp-open"); });
  speedMenu.addEventListener("click", (e) => {
    const btn = e.target.closest(".cvp-speed-option");
    if (btn) setSpeed(parseFloat(btn.dataset.speed));
  });
  document.addEventListener("click", (e) => { if (!speedWrap.contains(e.target)) speedMenu.classList.remove("cvp-open"); });
  pipBtn.addEventListener("click", togglePiP);
  fullscreenBtn.addEventListener("click", toggleFullscreen);

  // ---- Double-tap-to-seek zones (touch) + single tap toggles controls ----
  function bindTapZone(el, direction, flashEl) {
    let lastTap = 0;
    let tapTimer = null;
    el.addEventListener(
      "touchend",
      (e) => {
        e.stopPropagation();
        const now = Date.now();
        if (now - lastTap < 320) {
          clearTimeout(tapTimer);
          seekBy(direction * SEEK_STEP);
          flashSeek(flashEl, direction);
          lastTap = 0;
        } else {
          lastTap = now;
          tapTimer = setTimeout(() => { togglePlay(); showControls(); }, 320);
        }
      },
      { passive: true }
    );
  }
  bindTapZone(tapLeft, -1, flashLeft);
  bindTapZone(tapRight, 1, flashRight);

  // ---- Auto-hide controls on inactivity ----
  root.addEventListener("mousemove", showControls);
  root.addEventListener("touchstart", showControls, { passive: true });
  root.addEventListener("mouseleave", () => { if (!(adapter && adapter.isPaused && adapter.isPaused())) scheduleHide(); });

  // ---- Keyboard shortcuts, only while this player is hovered/focused ----
  let hovering = false;
  root.addEventListener("mouseenter", () => (hovering = true));
  root.addEventListener("mouseleave", () => (hovering = false));
  function onKeydown(e) {
    if (!hovering && document.activeElement !== root) return;
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    switch (e.key) {
      case " ": case "k": case "K": e.preventDefault(); togglePlay(); showControls(); break;
      case "ArrowRight": e.preventDefault(); seekBy(ARROW_SEEK_STEP); showControls(); break;
      case "ArrowLeft": e.preventDefault(); seekBy(-ARROW_SEEK_STEP); showControls(); break;
      case "ArrowUp": e.preventDefault(); volRange.value = Math.min(1, parseFloat(volRange.value) + 0.1); volRange.dispatchEvent(new Event("input")); showControls(); break;
      case "ArrowDown": e.preventDefault(); volRange.value = Math.max(0, parseFloat(volRange.value) - 0.1); volRange.dispatchEvent(new Event("input")); showControls(); break;
      case "f": case "F": toggleFullscreen(); break;
      case "m": case "M": muteBtn.click(); break;
    }
  }
  document.addEventListener("keydown", onKeydown);

  // ---- Wire an adapter once it exists (immediate for file, async for YouTube) ----
  function wireAdapter() {
    if (!pipBtn) return;
    pipBtn.classList.toggle("cvp-unsupported", !adapter.supportsPiP);

    const initialVolume = getStoredVolume();
    const initialMuted = getStoredMuted();
    adapter.setVolume(initialMuted ? 0 : initialVolume);
    updateVolumeIcon(initialVolume, initialMuted);

    adapter.on("ready", (duration) => {
      knownDuration = duration || 0;
      timeDuration.textContent = formatClock(knownDuration);
      spinner.classList.remove("cvp-active");
      callbacks.onReady?.(knownDuration);
    });
    adapter.on("timeupdate", (t, d) => {
      if (d) knownDuration = d;
      updateProgress(t, d);
      updateBuffered();
      callbacks.onTimeUpdate?.(t, d || knownDuration);
    });
    adapter.on("play", () => { playPauseIcon(false); scheduleHide(); });
    adapter.on("playing", () => spinner.classList.remove("cvp-active"));
    adapter.on("pause", (t, d) => { playPauseIcon(true); showControls(); callbacks.onPause?.(t ?? adapter.getCurrentTime(), d || knownDuration); });
    adapter.on("waiting", () => spinner.classList.add("cvp-active"));
    adapter.on("ended", () => { playPauseIcon(true); showControls(); callbacks.onEnded?.(); });
    adapter.on("volumechange", (v, muted) => updateVolumeIcon(v ?? adapter.getVolume(), muted ?? adapter.isMuted()));
    adapter.on("error", () => showErrorState(container, source.url));
  }

  // ---- Build the actual media element per source type ----
  if (source.type === "file") {
    const videoEl = document.createElement("video");
    videoEl.className = "cvp-video";
    videoEl.src = source.url;
    videoEl.playsInline = true;
    videoEl.preload = "metadata";
    mediaWrap.appendChild(videoEl);
    adapter = createNativeAdapter(videoEl);
    wireAdapter();
  } else if (source.type === "youtube") {
    spinner.classList.add("cvp-active");
    const target = document.createElement("div");
    target.className = "cvp-yt-target";
    const divId = `cvp-yt-${Math.random().toString(36).slice(2)}`;
    target.id = divId;
    mediaWrap.appendChild(target);
    loadYouTubeApi()
      .then((YT) => {
        if (destroyed) return;
        const player = new YT.Player(divId, {
          videoId: source.yid,
          playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0 },
          events: {
            onReady: () => { if (destroyed) return; adapter = createYouTubeAdapter(player, YT); wireAdapter(); },
            onError: () => showErrorState(container, ""),
          },
        });
      })
      .catch(() => showErrorState(container, ""));
  }

  return {
    seek: (t) => adapter?.seek(t),
    getCurrentTime: () => adapter?.getCurrentTime() || 0,
    getDuration: () => adapter?.getDuration() || knownDuration || 0,
    destroy: () => {
      destroyed = true;
      document.removeEventListener("keydown", onKeydown);
      clearTimeout(hideTimer);
      adapter?.destroy();
    },
  };
}
