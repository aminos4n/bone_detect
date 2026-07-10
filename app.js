import {
  FilesetResolver,
  ObjectDetector,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const DETECTOR_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";
const DETECTOR_WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const REQUIRED_FRAMES = 10;
const SAMPLE_INTERVAL_MS = 150;
const RESET_AFTER_MS = 4000;
const OUTCOME_EFFECT_MS = 5000;
const ROUND_PROMPT_MS = 2800;
const WELCOME_AUDIO_MS = 2400;
const INVITE_AUDIO_MS = 2100;
const DRAW_AUDIO_MS = 2000;
const LOSE_AUDIO_MS = 2400;
const WIN_AUDIO_MS = 2400;
const CAMERA_LABEL_HINTS = ["front", "user", "face", "facetime", "selfie", "internal", "built-in", "built in"];

const currentUrl = new URL(window.location.href);
const pathSegments = currentUrl.pathname.split("/").filter(Boolean);
const lastSegment = pathSegments.at(-1) || "";
const PAGE_VIEW =
  currentUrl.searchParams.get("view") === "edit" || lastSegment === "edit" || lastSegment === "edit.html"
    ? "edit"
    : "display";
const IS_DISPLAY_VIEW = PAGE_VIEW === "display";
const IS_EDIT_VIEW = PAGE_VIEW === "edit";

document.body.dataset.view = PAGE_VIEW;

const hands = {
  rock: { name: "ぐー", icon: "✊" },
  scissors: { name: "ちょき", icon: "✌️" },
  paper: { name: "ぱー", icon: "✋" },
};

const winMap = {
  rock: "scissors",
  scissors: "paper",
  paper: "rock",
};

const app = document.getElementById("app");
const sceneLabel = document.getElementById("sceneLabel");
const personStatus = document.getElementById("personStatus");
const detectorStatus = document.getElementById("detectorStatus");
const speechBubble = document.getElementById("speechBubble");
const mainHeading = document.getElementById("mainHeading");
const subHeading = document.getElementById("subHeading");
const videoBanner = document.getElementById("videoBanner");
const frameValue = document.getElementById("frameValue");
const roundStatus = document.getElementById("roundStatus");
const roundMessage = document.getElementById("roundMessage");
const cameraVideo = document.getElementById("cameraVideo");
const overlayCanvas = document.getElementById("overlayCanvas");
const effectLayer = document.getElementById("effectLayer");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const detectorHint = document.getElementById("detectorHint");
const startButton = document.getElementById("startButton");
const soundTestButton = document.getElementById("soundTestButton");
const resetButton = document.getElementById("resetButton");
const handButtons = [...document.querySelectorAll(".hand-button")];
const debugButtons = [...document.querySelectorAll(".debug-button")];

const counters = {
  wins: document.getElementById("wins"),
  draws: document.getElementById("draws"),
  losses: document.getElementById("losses"),
  streak: document.getElementById("streak"),
};

const score = {
  wins: 0,
  draws: 0,
  losses: 0,
  streak: 0,
};

const audioBank = {
  welcome: new Audio("assets/audio/welcome.wav"),
  invite: new Audio("assets/audio/invite.wav"),
  janken: new Audio("assets/audio/janken.wav"),
  draw: new Audio("assets/audio/draw.wav"),
  lose: new Audio("assets/audio/lose.wav"),
  win: new Audio("assets/audio/win.wav"),
};

Object.values(audioBank).forEach((audio) => {
  audio.preload = "auto";
});

const state = {
  scene: "idle",
  cameraReady: false,
  detectorOnline: false,
  requestInFlight: false,
  audioArmed: false,
  cameraStarting: false,
  gameBusy: false,
  hasPresence: false,
  consecutiveDetectedFrames: 0,
  lastPersonSeenAt: 0,
  debugMode: "off",
  stream: null,
  detector: null,
  detectorLoading: null,
  welcomeEndsAt: 0,
  audioUnlocking: null,
};

const overlayContext = overlayCanvas.getContext("2d");

const sceneContent = {
  idle: {
    label: "まってるよ",
    speech: "カメラの まえに きてね!",
    heading: "じゃんけん ひろば",
    subheading: "カメラに うつると ごあいさつ するよ",
    banner: "ようこそ! カメラの まえに きてね",
  },
  detected: {
    label: "ごあいさつ",
    speech: "いらっしゃいませ! ごらいてん ありがとう!",
    heading: "みつけたよ!",
    subheading: "いらっしゃいませの あとで じゃんけんだよ",
    banner: "いらっしゃいませ!",
  },
  play: {
    label: "あそび",
    speech: "いっしょに あそぼう! じゃんけん しよう!",
    heading: "じゃんけん スタート!",
    subheading: "さいしょは ぐー の あとで おしてね",
    banner: "じゃんけん するよ!",
  },
};

const outcomeText = {
  win: "やったね! きみの かち!",
  lose: "ざんねん! また あそんでね!",
  draw: "あいこ! もう いっかい!",
};

const speechText = {
  win: "やったー! きみの かち!",
  lose: "ざんねん! また あそんでね!",
  draw: "あいこだ! もう いっかい!",
};

const burstColors = ["#ffd65a", "#ff78ae", "#9ed7ff", "#7dd7b4"];

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getAudioDurationMs(name, fallbackMs) {
  const audio = audioBank[name];
  const durationMs = Number.isFinite(audio?.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : 0;
  return Math.max(fallbackMs, durationMs);
}

function showDetectorHint(message) {
  if (detectorHint) {
    detectorHint.textContent = message;
  }
}

function getIdleHint() {
  return IS_EDIT_VIEW ? "ブラウザ内AIで ひとを みつけるよ" : "カメラに うつると はじまるよ";
}

function setScene(scene) {
  state.scene = scene;
  app.dataset.scene = scene;

  const content = sceneContent[scene];
  sceneLabel.textContent = content.label;
  speechBubble.textContent = content.speech;
  mainHeading.textContent = content.heading;
  subHeading.textContent = content.subheading;
  videoBanner.textContent = content.banner;
  roundStatus.textContent = scene === "play" ? "あそべるよ" : "まだ まってるよ";
}

function updateCounters() {
  Object.entries(score).forEach(([key, value]) => {
    counters[key].textContent = value;
  });
}

function resetScore() {
  score.wins = 0;
  score.draws = 0;
  score.losses = 0;
  score.streak = 0;
  updateCounters();
}

function updateMeters() {
  frameValue.textContent = `${state.consecutiveDetectedFrames} / ${REQUIRED_FRAMES}`;
  personStatus.textContent = state.hasPresence ? "みつけたよ" : "まだ みつけてないよ";
  detectorStatus.textContent = state.detectorOnline ? "うごいてる" : "じゅんび中";
}

function clearBoxes() {
  overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawBoxes(detections) {
  if (!IS_EDIT_VIEW) {
    clearBoxes();
    return;
  }

  const rect = overlayCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlayCanvas.width = Math.round(rect.width * dpr);
  overlayCanvas.height = Math.round(rect.height * dpr);
  overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  overlayContext.clearRect(0, 0, rect.width, rect.height);

  detections.forEach((detection, index) => {
    const x = detection.bbox.x * rect.width;
    const y = detection.bbox.y * rect.height;
    const width = detection.bbox.width * rect.width;
    const height = detection.bbox.height * rect.height;

    overlayContext.strokeStyle = burstColors[index % burstColors.length];
    overlayContext.lineWidth = 4;
    overlayContext.fillStyle = "rgba(255, 255, 255, 0.92)";
    overlayContext.font = '700 16px "Hiragino Sans", sans-serif';
    overlayContext.strokeRect(x, y, width, height);
    overlayContext.fillRect(x + 6, y + 6, 112, 28);
    overlayContext.fillStyle = "#24417e";
    overlayContext.fillText("ひと 検知", x + 14, y + 25);
  });
}

function addEffectMessage(text, modifierClass) {
  const message = document.createElement("div");
  message.className = `effect-message ${modifierClass}`;
  message.textContent = text;
  effectLayer.appendChild(message);
}

function clearEffectLayer() {
  effectLayer.classList.remove("is-winning", "is-losing");
  effectLayer.innerHTML = "";
}

function launchWinEffect() {
  effectLayer.innerHTML = "";
  effectLayer.classList.remove("is-losing");
  effectLayer.classList.add("is-winning");

  addEffectMessage("やったー!", "is-win");

  for (let index = 0; index < 36; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.background = burstColors[index % burstColors.length];
    piece.style.left = `${10 + (index % 9) * 10}%`;
    piece.style.top = `${18 + Math.floor(index / 9) * 15}%`;
    piece.style.setProperty("--dx", `${Math.cos((index / 36) * Math.PI * 2) * (180 + index * 4)}px`);
    piece.style.setProperty("--dy", `${Math.sin((index / 36) * Math.PI * 2) * (120 + index * 5)}px`);
    piece.style.setProperty("--spin", `${index % 2 === 0 ? 460 : -460}deg`);
    piece.style.animationDelay = `${(index % 6) * 0.08}s`;
    effectLayer.appendChild(piece);
  }

  for (let index = 0; index < 12; index += 1) {
    const star = document.createElement("span");
    star.className = "star-burst";
    star.textContent = "★";
    star.style.left = `${8 + (index % 4) * 24}%`;
    star.style.top = `${16 + Math.floor(index / 4) * 22}%`;
    star.style.animationDelay = `${index * 0.12}s`;
    effectLayer.appendChild(star);
  }

  window.setTimeout(clearEffectLayer, OUTCOME_EFFECT_MS);
}

function launchLoseEffect() {
  effectLayer.innerHTML = "";
  effectLayer.classList.remove("is-winning");
  effectLayer.classList.add("is-losing");

  addEffectMessage("ざんねん!", "is-lose");

  for (let index = 0; index < 16; index += 1) {
    const line = document.createElement("span");
    line.className = "lose-line";
    line.style.left = `${8 + index * 5.7}%`;
    line.style.height = `${42 + (index % 4) * 11}%`;
    line.style.animationDelay = `${(index % 4) * 0.16}s`;
    effectLayer.appendChild(line);
  }

  window.setTimeout(clearEffectLayer, OUTCOME_EFFECT_MS);
}

function setCameraPlaceholder(title, text) {
  cameraPlaceholder.querySelector(".placeholder-title").textContent = title;
  cameraPlaceholder.querySelector(".placeholder-text").textContent = text;
}

function getCameraErrorMessage(error) {
  if (error?.message === "MEDIA_UNAVAILABLE") {
    return {
      title: "カメラが みつからないよ",
      text: "このブラウザでは カメラを つかえないみたい",
      hint: "Chrome か Safari で ひらいてみてね",
    };
  }

  if (error?.message === "INSECURE_CONTEXT") {
    return {
      title: "カメラを つかう ばしょだよ",
      text: "このページは HTTPS か localhost で ひらいてね",
      hint: "GitHub Pages や Cloudflare Pages なら そのまま つかえるよ",
    };
  }

  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        title: "カメラの きょかが ひつようだよ",
        text: "ブラウザで カメラを きょかして もういちど",
        hint: "アドレスバーの カメラ設定を たしかめてね",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        title: "カメラが みつからないよ",
        text: "つかえるカメラが せつぞくされていないみたい",
        hint: "タブレットのカメラを かくにんしてね",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        title: "カメラが つかえないよ",
        text: "ほかのアプリが カメラを つかっているかも",
        hint: "ほかのカメラアプリを とじて もういちど",
      };
    default:
      return {
        title: "カメラが つかえないよ",
        text: "カメラの きょかを して もういちど",
        hint: "うまくいかないときは ページを さいど よみこんでね",
      };
  }
}

function scoreCameraLabel(label) {
  const lower = String(label || "").toLowerCase();

  if (!lower) {
    return 0;
  }

  let score = 0;

  CAMERA_LABEL_HINTS.forEach((hint) => {
    if (lower.includes(hint)) {
      score += 4;
    }
  });

  if (lower.includes("rear") || lower.includes("back") || lower.includes("world")) {
    score -= 6;
  }

  return score;
}

function buildVideoConstraints(overrides = {}) {
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 16 / 9 },
    ...overrides,
  };
}

async function getCameraStreamWithFallback() {
  const attempts = [
    { video: buildVideoConstraints({ facingMode: { ideal: "user" } }), audio: false },
    { video: buildVideoConstraints(), audio: false },
    { video: true, audio: false },
  ];

  let lastError = null;

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;

      if (error?.name === "NotAllowedError" || error?.name === "NotReadableError") {
        throw error;
      }
    }
  }

  throw lastError;
}

async function preferSelfFacingCamera(stream) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return stream;
  }

  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput",
  );

  if (devices.length < 2) {
    return stream;
  }

  const currentTrack = stream.getVideoTracks()[0];
  const currentLabel = currentTrack?.label || "";
  const currentScore = scoreCameraLabel(currentLabel);
  const rankedDevices = devices
    .map((device) => ({ ...device, score: scoreCameraLabel(device.label) }))
    .sort((left, right) => right.score - left.score);
  const bestDevice = rankedDevices[0];

  if (!bestDevice?.deviceId || bestDevice.score <= currentScore || bestDevice.score <= 0) {
    return stream;
  }

  const replacement = await navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints({ deviceId: { exact: bestDevice.deviceId } }),
    audio: false,
  });

  stream.getTracks().forEach((track) => track.stop());
  return replacement;
}

async function initBrowserDetector() {
  if (state.detector) {
    return state.detector;
  }

  if (state.detectorLoading) {
    return state.detectorLoading;
  }

  state.detectorLoading = (async () => {
    showDetectorHint("AIを よみこんでいるよ");
    const vision = await FilesetResolver.forVisionTasks(DETECTOR_WASM_ROOT);
    const detector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: DETECTOR_MODEL_URL,
      },
      categoryAllowlist: ["person"],
      maxResults: 3,
      runningMode: "VIDEO",
      scoreThreshold: 0.35,
    });

    state.detector = detector;
    state.detectorOnline = true;
    updateMeters();
    showDetectorHint("AIじゅんび OK");
    return detector;
  })().catch((error) => {
    state.detectorOnline = false;
    updateMeters();
    showDetectorHint("AIの よみこみに しっぱいしたよ");
    console.error(error);
    throw error;
  }).finally(() => {
    state.detectorLoading = null;
  });

  return state.detectorLoading;
}

function buildDetectionsFromResult(result) {
  const detections = Array.isArray(result?.detections) ? result.detections : [];

  return detections
    .map((detection) => {
      const category = detection.categories?.[0];
      const box = detection.boundingBox;

      if (!category || category.categoryName !== "person" || !box) {
        return null;
      }

      const width = cameraVideo.videoWidth || 1;
      const height = cameraVideo.videoHeight || 1;

      return {
        label: "person",
        confidence: Number(category.score || 0),
        bbox: {
          x: box.originX / width,
          y: box.originY / height,
          width: box.width / width,
          height: box.height / height,
        },
      };
    })
    .filter(Boolean);
}

async function startCamera() {
  if (state.cameraReady || state.cameraStarting) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    const message = getCameraErrorMessage(new Error("MEDIA_UNAVAILABLE"));
    cameraPlaceholder.hidden = false;
    setCameraPlaceholder(message.title, message.text);
    showDetectorHint(message.hint);
    return;
  }

  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    const message = getCameraErrorMessage(new Error("INSECURE_CONTEXT"));
    cameraPlaceholder.hidden = false;
    setCameraPlaceholder(message.title, message.text);
    showDetectorHint(message.hint);
    return;
  }

  state.cameraStarting = true;
  startButton.disabled = true;
  let nextStream = null;

  try {
    nextStream = await getCameraStreamWithFallback();
    nextStream = await preferSelfFacingCamera(nextStream);

    state.stream = nextStream;
    cameraVideo.srcObject = nextStream;
    await cameraVideo.play();
    await initBrowserDetector();

    state.cameraReady = true;
    state.audioArmed = true;
    cameraPlaceholder.hidden = true;
    setCameraPlaceholder("カメラを じゅんび しています", "カメラの きょかを まっているよ");
    roundMessage.textContent = "ひとを みつけると あそびモードに なるよ!";
    showDetectorHint("じぶんむき カメラで じゅんび OK");
  } catch (error) {
    const message = getCameraErrorMessage(error);
    nextStream?.getTracks?.().forEach((track) => track.stop());
    cameraPlaceholder.hidden = false;
    state.cameraReady = false;
    state.stream = null;
    setCameraPlaceholder(message.title, message.text);
    showDetectorHint(message.hint);
    console.error(error);
  } finally {
    state.cameraStarting = false;
    startButton.disabled = false;
  }
}

function stopCamera() {
  if (!state.stream) {
    return;
  }

  state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.cameraReady = false;
  state.cameraStarting = false;
  cameraVideo.srcObject = null;
  cameraPlaceholder.hidden = false;
}

function playAudio(name, options = {}) {
  if (!state.audioArmed || !audioBank[name]) {
    return;
  }

  const { exclusive = true } = options;

  if (exclusive) {
    Object.entries(audioBank).forEach(([key, audio]) => {
      if (key !== name) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  }

  const audio = audioBank[name];
  audio.pause();
  audio.currentTime = 0;
  audio.play().catch((error) => {
    console.warn("audio playback blocked", error);
  });
}

async function unlockAudioPlayback() {
  if (state.audioUnlocking) {
    return state.audioUnlocking;
  }

  state.audioUnlocking = (async () => {
    for (const audio of Object.values(audioBank)) {
      const previousMuted = audio.muted;
      audio.muted = true;
      audio.currentTime = 0;

      try {
        await audio.play();
      } catch (error) {
        console.warn("audio unlock skipped", error);
      }

      audio.pause();
      audio.currentTime = 0;
      audio.muted = previousMuted;
    }
  })().finally(() => {
    state.audioUnlocking = null;
  });

  return state.audioUnlocking;
}

async function runSoundTest() {
  state.audioArmed = true;
  playAudio("welcome");
  await wait(getAudioDurationMs("welcome", WELCOME_AUDIO_MS));
  playAudio("invite");
  await wait(getAudioDurationMs("invite", INVITE_AUDIO_MS));
  playAudio("janken");
  await wait(getAudioDurationMs("janken", ROUND_PROMPT_MS));
  playAudio("draw");
  await wait(getAudioDurationMs("draw", DRAW_AUDIO_MS));
  playAudio("lose");
  await wait(getAudioDurationMs("lose", LOSE_AUDIO_MS));
  playAudio("win");
}

function pickCpuHand(playerHand) {
  const playerWinsHand = Object.keys(winMap).find((hand) => winMap[hand] === playerHand);
  const cpuLosesHand = winMap[playerHand];
  const roll = Math.random();

  if (roll < 0.3) {
    return cpuLosesHand;
  }

  if (roll < 0.5) {
    return playerHand;
  }

  return playerWinsHand;
}

function judgeRound(playerHand, cpuHand) {
  if (playerHand === cpuHand) {
    return "draw";
  }

  return winMap[playerHand] === cpuHand ? "win" : "lose";
}

function setGameBusy(busy) {
  state.gameBusy = busy;
  handButtons.forEach((button) => {
    button.disabled = busy || state.scene !== "play";
  });
}

function updateScore(result) {
  if (result === "win") {
    score.wins += 1;
    score.streak += 1;
  } else if (result === "lose") {
    score.losses += 1;
    score.streak = 0;
  } else {
    score.draws += 1;
  }

  updateCounters();
}

async function primeRound(options = {}) {
  const { withInvite = false } = options;

  if (state.scene !== "play") {
    return;
  }

  setGameBusy(true);
  roundStatus.textContent = "じゅんび中";
  roundMessage.textContent = "さいしょは ぐー を きいてね!";

  if (withInvite) {
    const remainingWelcomeMs = Math.max(0, state.welcomeEndsAt - Date.now());
    if (remainingWelcomeMs > 0) {
      await wait(remainingWelcomeMs);
    }

    if (state.scene !== "play") {
      return;
    }

    speechBubble.textContent = "いっしょに あそぼう!";
    playAudio("invite");
    await wait(getAudioDurationMs("invite", INVITE_AUDIO_MS));
  }

  if (state.scene !== "play") {
    return;
  }

  speechBubble.textContent = "さいしょは ぐー";
  roundStatus.textContent = "まっててね";
  roundMessage.textContent = "さいしょは ぐー の あとで おしてね!";
  playAudio("janken");
  await wait(getAudioDurationMs("janken", ROUND_PROMPT_MS));

  if (state.scene !== "play") {
    return;
  }

  speechBubble.textContent = "いま ボタンを おしてね!";
  roundStatus.textContent = "えらべるよ";
  roundMessage.textContent = "いま ぐー ちょき ぱー を おしてね!";
  setGameBusy(false);
}

async function playRound(playerHand) {
  if (state.scene !== "play" || state.gameBusy) {
    return;
  }

  setGameBusy(true);
  roundStatus.textContent = "しょうぶ中";
  roundMessage.textContent = `きみは ${hands[playerHand].name} を えらんだよ!`;
  speechBubble.textContent = "ぽん!";
  await wait(320);

  const cpuHand = pickCpuHand(playerHand);
  const result = judgeRound(playerHand, cpuHand);

  speechBubble.textContent = `${hands[cpuHand].name} を だしたよ!`;
  roundMessage.textContent = `${speechText[result]} きみ: ${hands[playerHand].name} / あいて: ${hands[cpuHand].name}`;
  roundStatus.textContent = outcomeText[result];
  updateScore(result);

  if (result === "win") {
    launchWinEffect();
    playAudio("win");
    await wait(Math.max(OUTCOME_EFFECT_MS, getAudioDurationMs("win", WIN_AUDIO_MS)));
  } else if (result === "lose") {
    launchLoseEffect();
    playAudio("lose");
    await wait(Math.max(OUTCOME_EFFECT_MS, getAudioDurationMs("lose", LOSE_AUDIO_MS)));
  } else {
    playAudio("draw");
    await wait(getAudioDurationMs("draw", DRAW_AUDIO_MS));
  }

  await primeRound();
}

function resetExperience(keepCamera = true) {
  state.hasPresence = false;
  state.consecutiveDetectedFrames = 0;
  state.lastPersonSeenAt = 0;
  state.requestInFlight = false;
  state.gameBusy = false;
  state.debugMode = "off";
  state.welcomeEndsAt = 0;

  setScene("idle");
  resetScore();
  updateMeters();
  roundMessage.textContent = "ひとを みつけると あそびが はじまるよ!";
  clearBoxes();
  clearEffectLayer();
  showDetectorHint(getIdleHint());
  setGameBusy(false);

  if (!keepCamera) {
    stopCamera();
  }
}

function enterPlayScene() {
  if (state.scene === "play") {
    return;
  }

  state.audioArmed = true;
  setScene("play");
  roundMessage.textContent = "さいしょは ぐー を きいてね!";
  primeRound({ withInvite: true });
}

function applyDetectionPayload(payload) {
  const detections = Array.isArray(payload?.detections) ? payload.detections : [];
  state.detectorOnline = true;

  if (detections.length > 0) {
    state.lastPersonSeenAt = Date.now();

    if (!state.hasPresence) {
      state.hasPresence = true;
      setScene("detected");
      state.welcomeEndsAt = Date.now() + getAudioDurationMs("welcome", WELCOME_AUDIO_MS);
      playAudio("welcome");
    }

    state.consecutiveDetectedFrames += 1;

    if (state.consecutiveDetectedFrames >= REQUIRED_FRAMES) {
      enterPlayScene();
    }
  } else {
    state.consecutiveDetectedFrames = 0;

    if (state.hasPresence && Date.now() - state.lastPersonSeenAt > RESET_AFTER_MS) {
      resetExperience(true);
    }
  }

  updateMeters();
  drawBoxes(detections);
}

function buildMockPayload(mode) {
  if (mode === "small") {
    return {
      detections: [
        {
          label: "person",
          bbox: { x: 0.32, y: 0.18, width: 0.28, height: 0.48 },
        },
      ],
    };
  }

  if (mode === "large") {
    return {
      detections: [
        {
          label: "person",
          bbox: { x: 0.14, y: 0.02, width: 0.72, height: 0.94 },
        },
      ],
    };
  }

  return { detections: [] };
}

function tickDebugMode() {
  if (!IS_EDIT_VIEW || state.debugMode === "off") {
    return false;
  }

  applyDetectionPayload(buildMockPayload(state.debugMode));
  return true;
}

async function requestDetections() {
  if (!state.cameraReady || state.requestInFlight || cameraVideo.readyState < 2) {
    return;
  }

  if (tickDebugMode()) {
    return;
  }

  if (!state.detector) {
    try {
      await initBrowserDetector();
    } catch {
      return;
    }
  }

  state.requestInFlight = true;

  try {
    const result = state.detector.detectForVideo(cameraVideo, performance.now());
    const detections = buildDetectionsFromResult(result);
    applyDetectionPayload({ detections });
  } catch (error) {
    state.detectorOnline = false;
    updateMeters();
    showDetectorHint("AIの うごきが とまったよ");
    console.error(error);
  } finally {
    state.requestInFlight = false;
  }
}

handButtons.forEach((button) => {
  button.addEventListener("click", () => {
    playRound(button.dataset.hand);
  });
});

startButton.addEventListener("click", () => {
  void unlockAudioPlayback();
  startCamera();
});

cameraPlaceholder.addEventListener("click", () => {
  void unlockAudioPlayback();
  if (IS_DISPLAY_VIEW && !state.cameraReady && !state.cameraStarting) {
    startCamera();
  }
});

soundTestButton.addEventListener("click", async () => {
  await runSoundTest();
});

resetButton.addEventListener("click", () => {
  resetExperience(true);
});

debugButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.debug;
    state.debugMode = mode === "none" ? "off" : mode;

    if (mode === "none") {
      applyDetectionPayload(buildMockPayload("none"));
    }
  });
});

window.addEventListener("resize", () => {
  clearBoxes();
});

window.addEventListener(
  "pointerdown",
  () => {
    void unlockAudioPlayback();
  },
  { once: true },
);

setScene("idle");
updateCounters();
updateMeters();
setGameBusy(false);
showDetectorHint(getIdleHint());

if (IS_DISPLAY_VIEW) {
  setCameraPlaceholder("カメラを じゅんびしています", "カメラの きょかを まっているよ");
  window.setTimeout(() => {
    startCamera();
  }, 120);
}

window.setInterval(requestDetections, SAMPLE_INTERVAL_MS);
