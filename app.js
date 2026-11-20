const MARKERS_STORAGE_KEY = "beatmarks-markers-v2";
const TRACKS_DB_NAME = "beatmarks-audio-db";
const TRACKS_STORE_NAME = "tracks";
const INITIAL_TRACKS_STORE_NAME = "initialTracks";
const LAST_TRACK_KEY = "beatmarks-last-track-id";

const audioFile = document.getElementById("audioFile");
const audio = document.getElementById("audio");
const appTitle = document.getElementById("appTitle");
const trackName = document.getElementById("trackName");
const trackList = document.getElementById("trackList");
const tracksCount = document.getElementById("tracksCount");
const initialTracksStatus = document.getElementById("initialTracksStatus");
const retryInitialTracks = document.getElementById("retryInitialTracks");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const progressBar = document.getElementById("progressBar");
const playPauseButton = document.getElementById("playPauseButton");

const markerForm = document.getElementById("markerForm");
const markerLabel = document.getElementById("markerLabel");
const markerTime = document.getElementById("markerTime");
const useCurrentTime = document.getElementById("useCurrentTime");
const addMarker = document.getElementById("addMarker");
const clearForm = document.getElementById("clearForm");

const markerList = document.getElementById("markerList");
const markersCount = document.getElementById("markersCount");
const exportMarkers = document.getElementById("exportMarkers");
const importMarkersButton = document.getElementById("importMarkersButton");
const importMarkersInput = document.getElementById("importMarkersInput");
const jsonFormatButton = document.getElementById("jsonFormatButton");
const jsonFormatHelp = document.getElementById("jsonFormatHelp");

const back5 = document.getElementById("back5");
const forward5 = document.getElementById("forward5");
const preRollSeconds = document.getElementById("preRollSeconds");
const openMenu = document.getElementById("openMenu");
const closeMenu = document.getElementById("closeMenu");
const sideMenu = document.getElementById("sideMenu");
const menuBackdrop = document.getElementById("menuBackdrop");
const prevTrack = document.getElementById("prevTrack");
const nextTrack = document.getElementById("nextTrack");

let preRollValue = loadPreRollValue();
if (preRollSeconds) preRollSeconds.value = String(preRollValue);

let markersByTrack = loadMarkersByTrack();
let currentTrackId = localStorage.getItem(LAST_TRACK_KEY) || null;
let currentObjectUrl = null;
let dbPromise = openTracksDb();

init();

async function init() {
  await restoreLastTrack();
  await renderSavedTracks();
  renderMarkers();
  updatePlayerTime();
  updatePlayPauseButton();
  await initializeInitialTracks();
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getTrackTitle(name) {
  const clean = String(name || "").trim();
  if (!clean) return "Файл пока не выбран";
  return clean.replace(/\.[^/.]+$/, "");
}

function setDisplayedTrackName(name, displayName = "") {
  const title = displayName || getTrackTitle(name);
  appTitle.textContent = title;
  trackName.textContent = title;
  trackName.title = title;
  appTitle.title = title;
}

function getTrackDisplayName(track) {
  return track.displayName || track.name;
}

function closeAllActionMenus() {
  document.querySelectorAll(".marker-action-menu.open").forEach((menu) => {
    menu.classList.remove("open");
    menu.previousElementSibling.setAttribute("aria-expanded", "false");
  });
}

function createActionMenu(label, actions) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "marker-menu-btn";
  button.textContent = "⋯";
  button.ariaLabel = label;
  button.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "marker-action-menu";

  actions.forEach((action) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = action.className;
    item.textContent = action.label;
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      closeAllActionMenus();
      action.onClick();
    });
    menu.appendChild(item);
  });

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const wasOpen = menu.classList.contains("open");
    closeAllActionMenus();
    menu.classList.toggle("open", !wasOpen);
    button.setAttribute("aria-expanded", String(!wasOpen));
  });

  return { button, menu };
}

function loadPreRollValue() {
  const saved = Number(localStorage.getItem("beatmarks-pre-roll-seconds") || "0");
  return Number.isFinite(saved) && saved >= 0 ? saved : 0;
}

function savePreRollValue(value) {
  preRollValue = Math.max(0, Number(value) || 0);
  localStorage.setItem("beatmarks-pre-roll-seconds", String(preRollValue));
}

function makeTrackId(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

function getCurrentMarkers() {
  if (!currentTrackId) return [];

  if (!Array.isArray(markersByTrack[currentTrackId])) {
    markersByTrack[currentTrackId] = [];
  }

  return markersByTrack[currentTrackId];
}

function loadMarkersByTrack() {
  try {
    const raw = localStorage.getItem(MARKERS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return { legacy: parsed };
    }

    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveMarkersByTrack() {
  localStorage.setItem(MARKERS_STORAGE_KEY, JSON.stringify(markersByTrack));
}

function openTracksDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRACKS_DB_NAME, 2);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(TRACKS_STORE_NAME)) {
        db.createObjectStore(TRACKS_STORE_NAME, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(INITIAL_TRACKS_STORE_NAME)) {
        db.createObjectStore(INITIAL_TRACKS_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onblocked = () => {
      initialTracksStatus.hidden = false;
      initialTracksStatus.textContent = "Для обновления хранилища закрой другие открытые вкладки BeatMarks.";
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        initialTracksStatus.hidden = false;
        initialTracksStatus.textContent = "Доступна новая версия хранилища. Обнови страницу.";
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function fetchInitialAsset(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${url}.`);
  }
  return response;
}

async function needsInitialTrack(id) {
  const db = await dbPromise;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([TRACKS_STORE_NAME, INITIAL_TRACKS_STORE_NAME], "readwrite");
    const initialized = tx.objectStore(INITIAL_TRACKS_STORE_NAME);
    const check = initialized.get(id);
    let needed = false;

    check.onsuccess = () => {
      if (check.result) return;

      const request = tx.objectStore(TRACKS_STORE_NAME).get(id);
      request.onsuccess = () => {
        needed = !request.result;
        if (!needed) initialized.put({ id });
      };
    };

    tx.oncomplete = () => resolve(needed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function initializeInitialTracks() {
  retryInitialTracks.disabled = true;
  retryInitialTracks.hidden = true;
  initialTracksStatus.hidden = false;
  initialTracksStatus.textContent = "Загружаю начальные треки…";

  try {
    const db = await dbPromise;
    const catalogResponse = await fetchInitialAsset("./initial-tracks.json");
    const catalog = await catalogResponse.json();
    for (const preset of catalog) {
      const id = makeTrackId(preset);
      if (!await needsInitialTrack(id)) continue;

      const [audioResponse, markersResponse] = await Promise.all([
        fetchInitialAsset(preset.audio),
        fetchInitialAsset(preset.markers)
      ]);
      const [data, markers] = await Promise.all([
        audioResponse.arrayBuffer(),
        markersResponse.json()
      ]);
      if (data.byteLength !== preset.size || !Array.isArray(markers)) {
        throw new Error("Неверный формат начального трека или меток.");
      }

      const addedTrack = await new Promise((resolve, reject) => {
        const tx = db.transaction([TRACKS_STORE_NAME, INITIAL_TRACKS_STORE_NAME], "readwrite");
        const tracks = tx.objectStore(TRACKS_STORE_NAME);
        const initialized = tx.objectStore(INITIAL_TRACKS_STORE_NAME);
        const check = initialized.get(id);
        let added = null;

        check.onsuccess = () => {
          if (check.result) return;

          const request = tracks.get(id);
          request.onsuccess = () => {
            if (!request.result) {
              try {
                const savedMarkers = loadMarkersByTrack();
                if (!Object.hasOwn(savedMarkers, id)) {
                  savedMarkers[id] = markers;
                  localStorage.setItem(MARKERS_STORAGE_KEY, JSON.stringify(savedMarkers));
                }
              } catch {
                tx.abort();
                return;
              }

              added = {
                id,
                name: preset.name,
                size: preset.size,
                type: "audio/mpeg",
                lastModified: preset.lastModified,
                savedAt: new Date().toISOString(),
                data
              };
              tracks.add(added);
            }
            initialized.put({ id });
          };
        };

        tx.oncomplete = () => resolve(added);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      markersByTrack = loadMarkersByTrack();
      if (addedTrack && !currentTrackId) {
        setAudioFromTrack(addedTrack, false);
      }
      await renderSavedTracks();
    }

    initialTracksStatus.hidden = true;
  } catch (error) {
    console.error("Ошибка загрузки начальных треков:", error);
    initialTracksStatus.textContent = "Не удалось загрузить начальные треки. Проверь подключение и повтори загрузку.";
    retryInitialTracks.hidden = false;
  } finally {
    retryInitialTracks.disabled = false;
    await renderSavedTracks();
    renderMarkers();
  }
}

async function saveTrackToDb(file) {
  const db = await dbPromise;
  const fileBuffer = await file.arrayBuffer();

  const track = {
    id: makeTrackId(file),
    name: file.name,
    size: file.size,
    type: file.type || "audio/mpeg",
    lastModified: file.lastModified,
    savedAt: new Date().toISOString(),
    data: fileBuffer
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS_STORE_NAME, "readwrite");
    const store = tx.objectStore(TRACKS_STORE_NAME);
    const request = store.get(track.id);

    request.onsuccess = () => {
      if (request.result?.displayName) {
        track.displayName = request.result.displayName;
      }
      store.put(track);
    };

    tx.oncomplete = () => resolve(track);
    tx.onerror = () => reject(tx.error || new Error("Не удалось записать файл в IndexedDB."));
    tx.onabort = () => reject(tx.error || new Error("Запись файла в IndexedDB была отменена."));
  });
}

async function getTrackFromDb(id) {
  if (!id) return null;

  const db = await dbPromise;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS_STORE_NAME, "readonly");
    const request = tx.objectStore(TRACKS_STORE_NAME).get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function getAllTracksFromDb() {
  const db = await dbPromise;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS_STORE_NAME, "readonly");
    const request = tx.objectStore(TRACKS_STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteTrackFromDb(trackId) {
  const db = await dbPromise;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([TRACKS_STORE_NAME, INITIAL_TRACKS_STORE_NAME], "readwrite");
    tx.objectStore(TRACKS_STORE_NAME).delete(trackId);
    tx.objectStore(INITIAL_TRACKS_STORE_NAME).put({ id: trackId });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function renameSavedTrack(track) {
  const enteredName = prompt("Название трека в приложении", getTrackDisplayName(track));
  if (enteredName === null) return;

  const displayName = enteredName.trim();
  if (!displayName) {
    alert("Введи название трека.");
    return;
  }

  try {
    const db = await dbPromise;
    const renamedTrack = await new Promise((resolve, reject) => {
      const tx = db.transaction(TRACKS_STORE_NAME, "readwrite");
      const store = tx.objectStore(TRACKS_STORE_NAME);
      const request = store.get(track.id);
      let updatedTrack = null;

      request.onsuccess = () => {
        if (!request.result) return;

        updatedTrack = { ...request.result, displayName };
        store.put(updatedTrack);
      };

      tx.oncomplete = () => resolve(updatedTrack);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    if (renamedTrack && track.id === currentTrackId) {
      setDisplayedTrackName(renamedTrack.name, renamedTrack.displayName);
    }
    await renderSavedTracks();
  } catch {
    alert("Не удалось сохранить название трека. Попробуй ещё раз.");
  }
}

async function renderSavedTracks() {
  if (!trackList || !tracksCount) return;

  try {
    const tracks = await getAllTracksFromDb();
    tracks.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));

    tracksCount.textContent = `${tracks.length} шт.`;
    trackList.innerHTML = "";

    if (tracks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Сохранённых треков пока нет. Загрузи первый MP3 ниже.";
      trackList.appendChild(empty);
      return;
    }

    tracks.forEach((track) => {
      const row = document.createElement("div");
      row.className = "marker";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const displayName = getTrackDisplayName(track);
      row.setAttribute("aria-label", `Открыть трек ${displayName}`);

      row.addEventListener("click", () => {
        if (track.id !== currentTrackId) setAudioFromTrack(track, true);
        closeTrackMenu();
      });

      row.addEventListener("keydown", (event) => {
        if (event.target === row && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          if (track.id !== currentTrackId) setAudioFromTrack(track, true);
          closeTrackMenu();
        }
      });

      const size = document.createElement("div");
      size.className = "marker-time";
      size.textContent = formatFileSize(track.size);

      const title = document.createElement("div");
      title.className = "marker-label";
      title.title = displayName;
      title.textContent = track.id === currentTrackId ? `▶ ${displayName}` : displayName;

      const actions = createActionMenu("Действия с треком", [
        {
          label: "Переименовать",
          className: "ghost",
          onClick: () => renameSavedTrack(track)
        },
        {
          label: "Удалить",
          className: "danger",
          onClick: async () => {
            const ok = confirm(`Удалить трек “${displayName}” и его метки из браузера?`);
            if (ok) await deleteSavedTrack(track.id);
          }
        }
      ]);

      row.append(size, title, actions.button, actions.menu);
      trackList.appendChild(row);
    });
  } catch {
    trackList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Не удалось прочитать список сохранённых треков.";
    trackList.appendChild(empty);
  }
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "—";

  const mb = bytes / 1024 / 1024;

  if (mb >= 1) return `${mb.toFixed(1)} МБ`;

  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

async function deleteSavedTrack(trackId) {
  await deleteTrackFromDb(trackId);

  delete markersByTrack[trackId];
  saveMarkersByTrack();

  if (trackId === currentTrackId) {
    localStorage.removeItem(LAST_TRACK_KEY);
    currentTrackId = null;

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }

    audio.removeAttribute("src");
    audio.load();
    setDisplayedTrackName("");
    updatePlayerTime();
    updatePlayPauseButton();
  }

  await renderSavedTracks();
  renderMarkers();
}

function getTrackBlob(track) {
  if (track.blob) {
    return track.blob;
  }

  if (track.data) {
    return new Blob([track.data], { type: track.type || "audio/mpeg" });
  }

  throw new Error("У сохранённого трека нет аудиоданных.");
}

function setAudioFromTrack(track, shouldPlay = true) {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentObjectUrl = URL.createObjectURL(getTrackBlob(track));
  currentTrackId = track.id;
  localStorage.setItem(LAST_TRACK_KEY, currentTrackId);

  audio.src = currentObjectUrl;
  audio.load();

  if (shouldPlay) {
    audio.play().catch(() => {
      // Браузер может запретить автозапуск.
    });
  }

  setDisplayedTrackName(track.name, track.displayName);

  if (!markersByTrack[currentTrackId]) {
    markersByTrack[currentTrackId] = [];
  }

  saveMarkersByTrack();
  renderMarkers();
  renderSavedTracks();
  updatePlayPauseButton();
}

async function restoreLastTrack() {
  if (!currentTrackId) {
    setDisplayedTrackName("");
    return;
  }

  try {
    const track = await getTrackFromDb(currentTrackId);

    if (!track) {
      setDisplayedTrackName("Файл пока не выбран");
      currentTrackId = null;
      localStorage.removeItem(LAST_TRACK_KEY);
      return;
    }

    setAudioFromTrack(track, false);
  } catch {
    setDisplayedTrackName("Файл пока не выбран");
  }
}

function renderMarkers() {
  const markers = getCurrentMarkers();
  markers.sort((a, b) => a.time - b.time);

  markersCount.textContent = `${markers.length} шт.`;
  markerList.innerHTML = "";

  if (!currentTrackId) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Сначала выбери MP3-файл через меню. После этого метки будут здесь, как обложка в музыкальном приложении.";
    markerList.appendChild(empty);
    return;
  }

  if (markers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Меток для этого трека пока нет. Промотай вниз и добавь первую.";
    markerList.appendChild(empty);
    return;
  }

  markers.forEach((marker, index) => {
    const row = document.createElement("div");
    row.className = "marker";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Перейти к метке ${marker.label}`);

    row.addEventListener("click", () => jumpTo(marker.time));

    row.addEventListener("keydown", (event) => {
      if (event.target === row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        jumpTo(marker.time);
      }
    });

    const time = document.createElement("div");
    time.className = "marker-time";
    time.textContent = formatTime(marker.time);

    const label = document.createElement("div");
    label.className = "marker-label";
    label.title = marker.label;
    label.textContent = marker.label || "Без названия";

    const actions = createActionMenu("Изменить или удалить метку", [
      {
        label: "Изменить",
        className: "ghost",
        onClick: () => editMarker(index)
      },
      {
        label: "Удалить",
        className: "danger",
        onClick: () => removeMarker(index)
      }
    ]);

    row.append(time, label, actions.button, actions.menu);
    markerList.appendChild(row);
  });
}

function jumpTo(time) {
  if (!audio.src) {
    alert("Сначала выбери MP3-файл.");
    return;
  }

  audio.currentTime = Math.max(0, (Number(time) || 0) - preRollValue);

  audio.play().catch(() => {
    // На некоторых телефонах браузер может запретить автозапуск.
  });
}

function addOrUpdateMarker() {
  if (!currentTrackId) {
    alert("Сначала выбери MP3-файл, чтобы сохранить метку для конкретного трека.");
    return;
  }

  const label = markerLabel.value.trim() || "Без названия";
  const time = Number(markerTime.value);

  if (!Number.isFinite(time) || time < 0) {
    alert("Введи корректную секунду, например 72 или 72.5.");
    return;
  }

  const markers = getCurrentMarkers();

  markers.push({
    label,
    time: Number(time.toFixed(1)),
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
  });

  markerLabel.value = "";
  markerTime.value = "";

  saveMarkersByTrack();
  renderMarkers();
}

function editMarker(index) {
  const markers = getCurrentMarkers();
  const marker = markers[index];

  if (!marker) return;

  markerLabel.value = marker.label;
  markerTime.value = marker.time;

  markers.splice(index, 1);

  saveMarkersByTrack();
  renderMarkers();
  markerForm.open = true;
  markerLabel.focus();
}

function removeMarker(index) {
  const markers = getCurrentMarkers();
  const marker = markers[index];

  if (!marker) return;
  markers.splice(index, 1);

  saveMarkersByTrack();
  renderMarkers();
}

function updatePlayerTime() {
  currentTimeEl.textContent = formatTime(audio.currentTime);
  durationEl.textContent = formatTime(audio.duration);

  const canSeek = Boolean(audio.src) && Number.isFinite(audio.duration) && audio.duration > 0;
  const percent = canSeek ? Math.min(100, Math.max(0, audio.currentTime / audio.duration * 100)) : 0;

  progressBar.disabled = !canSeek;
  progressBar.value = String(percent);
  progressBar.style.setProperty("--progress", `${percent}%`);
  progressBar.setAttribute("aria-valuetext", `${currentTimeEl.textContent} из ${durationEl.textContent}`);
}

function updatePlayPauseButton() {
  if (!audio.src || audio.paused) {
    playPauseButton.textContent = "▶";
    playPauseButton.classList.remove("is-pause");
    playPauseButton.setAttribute("aria-label", "Продолжить");
    playPauseButton.title = "Продолжить";
  } else {
    playPauseButton.textContent = "⏸";
    playPauseButton.classList.add("is-pause");
    playPauseButton.setAttribute("aria-label", "Пауза");
    playPauseButton.title = "Пауза";
  }
}

function exportMarkersToJson() {
  const data = JSON.stringify({
    version: 2,
    currentTrackId,
    markersByTrack
  }, null, 2);

  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "beatmarks-markers.json";

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function importMarkersFromJson(file) {
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));

      if (Array.isArray(parsed)) {
        if (!currentTrackId) {
          alert("Сначала выбери MP3-файл, затем импортируй старый JSON со списком меток.");
          return;
        }

        markersByTrack[currentTrackId] = parsed;
      } else if (parsed && typeof parsed === "object" && parsed.markersByTrack) {
        markersByTrack = parsed.markersByTrack;
      } else {
        throw new Error("Неверный формат JSON.");
      }

      saveMarkersByTrack();
      renderMarkers();
    } catch {
      alert("Не удалось импортировать JSON. Проверь формат файла.");
    }
  };

  reader.readAsText(file);
}

function openTrackMenu() {
  sideMenu.classList.add("open");
  menuBackdrop.classList.add("open");
}

function closeTrackMenu() {
  sideMenu.classList.remove("open");
  menuBackdrop.classList.remove("open");
}

async function switchTrack(direction) {
  const tracks = await getAllTracksFromDb();
  tracks.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
  if (tracks.length === 0) {
    alert("Сначала добавь MP3 через меню.");
    return;
  }

  const currentIndex = Math.max(0, tracks.findIndex((track) => track.id === currentTrackId));
  const nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
  setAudioFromTrack(tracks[nextIndex], true);
}

audioFile.addEventListener("change", async () => {
  const file = audioFile.files && audioFile.files[0];

  if (!file) return;

  try {
    setDisplayedTrackName("Сохраняю файл...");

    const track = await saveTrackToDb(file);

    setAudioFromTrack(track, true);
    await renderSavedTracks();
  } catch (error) {
    console.error("Ошибка сохранения MP3:", error);

    alert(`Не удалось сохранить MP3 в браузере. Причина: ${error && error.message ? error.message : "неизвестная ошибка"}`);

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
    }

    currentObjectUrl = URL.createObjectURL(file);
    currentTrackId = makeTrackId(file);
    localStorage.setItem(LAST_TRACK_KEY, currentTrackId);

    audio.src = currentObjectUrl;
    audio.load();

    audio.play().catch(() => {
      // Браузер может запретить автозапуск.
    });

    setDisplayedTrackName(file.name);

    renderMarkers();
    await renderSavedTracks();
    updatePlayPauseButton();
  }
});

audio.addEventListener("timeupdate", updatePlayerTime);
audio.addEventListener("loadedmetadata", updatePlayerTime);
audio.addEventListener("durationchange", updatePlayerTime);

audio.addEventListener("play", updatePlayPauseButton);
audio.addEventListener("pause", updatePlayPauseButton);
audio.addEventListener("ended", updatePlayPauseButton);

playPauseButton.addEventListener("click", () => {
  if (!audio.src) {
    alert("Сначала выбери MP3-файл.");
    return;
  }

  if (audio.paused) {
    audio.play().catch(() => {
      alert("Не удалось запустить трек. Попробуй нажать Play в плеере.");
    });
  } else {
    audio.pause();
  }
});

progressBar.addEventListener("input", () => {
  if (!audio.src || !Number.isFinite(audio.duration) || audio.duration <= 0) {
    return;
  }

  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.duration * progressBar.valueAsNumber / 100));
  updatePlayerTime();
});

useCurrentTime.addEventListener("click", () => {
  markerTime.value = Number(audio.currentTime || 0).toFixed(1);
});

addMarker.addEventListener("click", addOrUpdateMarker);

clearForm.addEventListener("click", () => {
  markerLabel.value = "";
  markerTime.value = "";
});

back5.addEventListener("click", () => {
  audio.currentTime = Math.max(0, (audio.currentTime || 0) - 5);
});

forward5.addEventListener("click", () => {
  audio.currentTime = Math.min(audio.duration || Infinity, (audio.currentTime || 0) + 5);
});

prevTrack.addEventListener("click", () => switchTrack(-1));
nextTrack.addEventListener("click", () => switchTrack(1));
openMenu.addEventListener("click", openTrackMenu);
closeMenu.addEventListener("click", closeTrackMenu);
menuBackdrop.addEventListener("click", closeTrackMenu);

preRollSeconds.addEventListener("input", () => {
  savePreRollValue(preRollSeconds.value);
});

retryInitialTracks.addEventListener("click", initializeInitialTracks);

exportMarkers.addEventListener("click", exportMarkersToJson);

importMarkersButton.addEventListener("click", () => {
  importMarkersInput.click();
});

jsonFormatButton.addEventListener("click", () => {
  jsonFormatHelp.hidden = !jsonFormatHelp.hidden;
  jsonFormatButton.setAttribute("aria-expanded", String(!jsonFormatHelp.hidden));
});

importMarkersInput.addEventListener("change", () => {
  const file = importMarkersInput.files && importMarkersInput.files[0];

  if (file) importMarkersFromJson(file);

  importMarkersInput.value = "";
});

document.addEventListener("click", closeAllActionMenus);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAllActionMenus();
    closeTrackMenu();
  }
});

const markersScroll = document.querySelector(".markers-scroll");
if (markersScroll) {
  markersScroll.addEventListener("wheel", (event) => {
    const atTop = markersScroll.scrollTop <= 0;
    const atBottom = Math.ceil(markersScroll.scrollTop + markersScroll.clientHeight) >= markersScroll.scrollHeight;

    if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
      event.preventDefault();
      window.scrollBy({ top: event.deltaY, left: 0, behavior: "auto" });
    }
  }, { passive: false });
}
