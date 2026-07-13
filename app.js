import {
  FilesetResolver,
  GestureRecognizer,
  ObjectDetector,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const DETECTOR_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";
const GESTURE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";
const DETECTOR_WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const WELCOME_FRAMES = 10;
const PLAY_READY_FRAMES = 30;
const GESTURE_CONFIRM_FRAMES = 4;
const SAMPLE_INTERVAL_MS = 150;
const RESET_MISSING_FRAMES = 14;
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

const gestureToHand = {
  Closed_Fist: "rock",
  Victory: "scissors",
  Open_Palm: "paper",
};

const handColors = {
  rock: "#ffb55a",
  scissors: "#ff78ae",
  paper: "#7dd7b4",
  default: "#9ed7ff",
};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const app = document.getElementById("app");
const sceneLabel = document.getElementById("sceneLabel");
const personStatus = document.getElementById("personStatus");
const detectorStatus = document.getElementById("detectorStatus");
const speechBubble = document.getElementById("speechBubble");
const avatarHandDisplay = document.getElementById("avatarHandDisplay");
const avatarHandEmoji = document.getElementById("avatarHandEmoji");
const avatarHandName = document.getElementById("avatarHandName");
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
  flowId: 0,
  cameraReady: false,
  detectorOnline: false,
  requestInFlight: false,
  audioArmed: false,
  cameraStarting: false,
  gameBusy: false,
  hasPresence: false,
  consecutiveDetectedFrames: 0,
  consecutiveMissingFrames: 0,
  debugMode: "off",
  stream: null,
  detector: null,
  detectorLoading: null,
  gestureRecognizer: null,
  gestureLoading: null,
  vision: null,
  visionLoading: null,
  welcomeEndsAt: 0,
  audioUnlocking: null,
  welcomePlayback: Promise.resolve(),
  gestureArmed: false,
  pendingGestureHand: null,
  pendingGestureFrames: 0,
  currentGestureCandidate: null,
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
    subheading: "さいしょは ぐー の あとで てを みせてね",
    banner: "てを みせて じゃんけん するよ!",
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
  return IS_EDIT_VIEW ? "ブラウザ内AIで ひとと てを みるよ" : "カメラに うつって てを みせてね";
}

function isFlowActive(flowId) {
  return flowId === state.flowId;
}

function setSpeech(text) {
  speechBubble.textContent = text;
}

function showAvatarHand(hand) {
  if (!avatarHandDisplay || !avatarHandEmoji || !avatarHandName || !hands[hand]) {
    return;
  }

  avatarHandDisplay.hidden = false;
  avatarHandDisplay.dataset.hand = hand;
  avatarHandEmoji.textContent = hands[hand].icon;
  avatarHandName.textContent = hands[hand].name;
  avatarHandDisplay.classList.add("is-visible");
}

function hideAvatarHand() {
  if (!avatarHandDisplay) {
    return;
  }

  avatarHandDisplay.classList.remove("is-visible");
  avatarHandDisplay.hidden = true;
  delete avatarHandDisplay.dataset.hand;
}

function setGestureArmed(armed) {
  state.gestureArmed = armed;
  state.pendingGestureHand = null;
  state.pendingGestureFrames = 0;
}

function setScene(scene) {
  state.scene = scene;
  app.dataset.scene = scene;

  const content = sceneContent[scene];
  sceneLabel.textContent = content.label;
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
  frameValue.textContent = `${Math.min(state.consecutiveDetectedFrames, PLAY_READY_FRAMES)} / ${PLAY_READY_FRAMES}`;
  personStatus.textContent = state.hasPresence ? "みつけたよ" : "まだ みつけてないよ";
  detectorStatus.textContent = state.detectorOnline ? "うごいてる" : "じゅんび中";
}

function refreshAiStatus() {
  state.detectorOnline = Boolean(state.detector && state.gestureRecognizer);
  updateMeters();
}

function clearBoxes() {
  overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function setupOverlayCanvas() {
  const rect = overlayCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlayCanvas.width = Math.round(rect.width * dpr);
  overlayCanvas.height = Math.round(rect.height * dpr);
  overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  overlayContext.clearRect(0, 0, rect.width, rect.height);
  return rect;
}

function drawPersonBoxes(detections, rect) {
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

function drawHandSkeleton(candidate, rect) {
  const landmarks = Array.isArray(candidate?.landmarks) ? candidate.landmarks : [];

  if (landmarks.length < 2) {
    return;
  }

  const color = handColors[candidate.hand] || handColors.default;
  const pointRadius = IS_EDIT_VIEW ? 4.5 : 5.5;
  const lineWidth = IS_EDIT_VIEW ? 3.5 : 4.5;

  overlayContext.save();
  overlayContext.strokeStyle = color;
  overlayContext.fillStyle = color;
  overlayContext.lineWidth = lineWidth;
  overlayContext.lineCap = "round";
  overlayContext.lineJoin = "round";
  overlayContext.shadowColor = `${color}99`;
  overlayContext.shadowBlur = IS_EDIT_VIEW ? 12 : 18;

  HAND_CONNECTIONS.forEach(([fromIndex, toIndex]) => {
    const from = landmarks[fromIndex];
    const to = landmarks[toIndex];

    if (!from || !to) {
      return;
    }

    overlayContext.beginPath();
    overlayContext.moveTo(from.x * rect.width, from.y * rect.height);
    overlayContext.lineTo(to.x * rect.width, to.y * rect.height);
    overlayContext.stroke();
  });

  landmarks.forEach((point, index) => {
    const x = point.x * rect.width;
    const y = point.y * rect.height;
    overlayContext.beginPath();
    overlayContext.arc(x, y, index === 0 ? pointRadius + 1.5 : pointRadius, 0, Math.PI * 2);
    overlayContext.fill();
  });

  if (candidate.hand && hands[candidate.hand]) {
    overlayContext.shadowBlur = 0;
    overlayContext.fillStyle = "rgba(255, 255, 255, 0.94)";
    overlayContext.strokeStyle = color;
    overlayContext.lineWidth = 2;
    overlayContext.font = '800 18px "Hiragino Sans", sans-serif';
    const label = `て: ${hands[candidate.hand].name}`;
    const textWidth = overlayContext.measureText(label).width;
    const boxWidth = textWidth + 24;
    const boxHeight = 30;
    const anchor = landmarks[0];
    const boxX = Math.max(12, Math.min(rect.width - boxWidth - 12, anchor.x * rect.width - boxWidth / 2));
    const boxY = Math.max(14, anchor.y * rect.height - 42);
    overlayContext.beginPath();
    overlayContext.roundRect(boxX, boxY, boxWidth, boxHeight, 14);
    overlayContext.fill();
    overlayContext.stroke();
    overlayContext.fillStyle = "#24417e";
    overlayContext.fillText(label, boxX + 12, boxY + 21);
  }

  overlayContext.restore();
}

function drawBoxes(detections, candidate = null) {
  const shouldDrawHand = Boolean(candidate?.landmarks?.length) && (state.hasPresence || state.scene === "play" || IS_EDIT_VIEW);

  if (!IS_EDIT_VIEW && !shouldDrawHand) {
    clearBoxes();
    return;
  }

  const rect = setupOverlayCanvas();

  if (IS_EDIT_VIEW) {
    drawPersonBoxes(detections, rect);
  }

  if (shouldDrawHand) {
    drawHandSkeleton(candidate, rect);
  }
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

async function getVisionResolver() {
  if (state.vision) {
    return state.vision;
  }

  if (state.visionLoading) {
    return state.visionLoading;
  }

  state.visionLoading = FilesetResolver.forVisionTasks(DETECTOR_WASM_ROOT)
    .then((vision) => {
      state.vision = vision;
      return vision;
    })
    .finally(() => {
      state.visionLoading = null;
    });

  return state.visionLoading;
}

async function initBrowserDetector() {
  if (state.detector) {
    return state.detector;
  }

  if (state.detectorLoading) {
    return state.detectorLoading;
  }

  state.detectorLoading = (async () => {
    showDetectorHint("ひとのAIを よみこんでいるよ");
    const vision = await getVisionResolver();
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
    refreshAiStatus();
    showDetectorHint("ひとのAI じゅんび OK");
    return detector;
  })().catch((error) => {
    refreshAiStatus();
    showDetectorHint("ひとのAI よみこみに しっぱいしたよ");
    console.error(error);
    throw error;
  }).finally(() => {
    state.detectorLoading = null;
  });

  return state.detectorLoading;
}

async function initGestureRecognizer() {
  if (state.gestureRecognizer) {
    return state.gestureRecognizer;
  }

  if (state.gestureLoading) {
    return state.gestureLoading;
  }

  state.gestureLoading = (async () => {
    showDetectorHint("てのAIを よみこんでいるよ");
    const vision = await getVisionResolver();
    const recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: GESTURE_MODEL_URL,
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
      cannedGesturesClassifierOptions: {
        categoryAllowlist: Object.keys(gestureToHand),
        scoreThreshold: 0.45,
        maxResults: 1,
      },
    });

    state.gestureRecognizer = recognizer;
    refreshAiStatus();
    showDetectorHint("てのAI じゅんび OK");
    return recognizer;
  })().catch((error) => {
    refreshAiStatus();
    showDetectorHint("てのAI よみこみに しっぱいしたよ");
    console.error(error);
    throw error;
  }).finally(() => {
    state.gestureLoading = null;
  });

  return state.gestureLoading;
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

function extractGestureCandidate(result) {
  const gestureGroups = Array.isArray(result?.gestures) ? result.gestures : [];
  let bestCandidate = null;

  gestureGroups.forEach((categories, index) => {
    const topCategory = Array.isArray(categories)
      ? categories.find((category) => gestureToHand[category.categoryName])
      : null;

    if (!topCategory) {
      return;
    }

    const candidate = {
      hand: gestureToHand[topCategory.categoryName],
      gestureName: topCategory.categoryName,
      score: Number(topCategory.score || 0),
      landmarks: Array.isArray(result?.landmarks?.[index]) ? result.landmarks[index] : [],
    };

    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  });

  return bestCandidate;
}

function updateGestureCandidate(candidate) {
  state.currentGestureCandidate = candidate;

  if (!state.gestureArmed || state.scene !== "play" || state.gameBusy) {
    state.pendingGestureHand = null;
    state.pendingGestureFrames = 0;
    return;
  }

  if (!candidate) {
    state.pendingGestureHand = null;
    state.pendingGestureFrames = 0;
    roundMessage.textContent = "てを カメラに みせてね!";
    return;
  }

  if (state.pendingGestureHand === candidate.hand) {
    state.pendingGestureFrames += 1;
  } else {
    state.pendingGestureHand = candidate.hand;
    state.pendingGestureFrames = 1;
  }

  if (state.pendingGestureFrames >= GESTURE_CONFIRM_FRAMES) {
    const confirmedHand = state.pendingGestureHand;
    roundMessage.textContent = `${hands[confirmedHand].name} に きまったよ!`;
    setGestureArmed(false);
    void playRound(confirmedHand);
    return;
  }

  roundMessage.textContent = `${hands[candidate.hand].name} を よんでるよ ${state.pendingGestureFrames}/${GESTURE_CONFIRM_FRAMES}`;
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
    await initGestureRecognizer();

    state.cameraReady = true;
    state.audioArmed = true;
    cameraPlaceholder.hidden = true;
    setCameraPlaceholder("カメラを じゅんび しています", "カメラの きょかを まっているよ");
    roundMessage.textContent = "ひとを みつけて てを みせると あそべるよ!";
    showDetectorHint("ひとと てのAIで じゅんび OK");
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

function stopAllAudio() {
  Object.values(audioBank).forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });
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

async function playAudioAndWait(name, fallbackMs, options = {}) {
  if (!state.audioArmed || !audioBank[name]) {
    return false;
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

  try {
    await audio.play();
  } catch (error) {
    console.warn("audio playback blocked", error);
    return false;
  }

  await new Promise((resolve) => {
    let settled = false;
    const timeoutMs = getAudioDurationMs(name, fallbackMs) + 400;

    const cleanup = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      audio.removeEventListener("ended", handleDone);
      audio.removeEventListener("error", handleDone);
      resolve();
    };

    const handleDone = () => {
      cleanup();
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
    }, timeoutMs);

    audio.addEventListener("ended", handleDone, { once: true });
    audio.addEventListener("error", handleDone, { once: true });
  });

  return true;
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
  await playAudioAndWait("welcome", WELCOME_AUDIO_MS);
  await playAudioAndWait("invite", INVITE_AUDIO_MS);
  await playAudioAndWait("janken", ROUND_PROMPT_MS);
  await playAudioAndWait("draw", DRAW_AUDIO_MS);
  await playAudioAndWait("lose", LOSE_AUDIO_MS);
  await playAudioAndWait("win", WIN_AUDIO_MS);
}

function pickCpuHand(playerHand) {
  const allHands = Object.keys(hands);
  return allHands[Math.floor(Math.random() * allHands.length)];
}

function judgeRound(playerHand, cpuHand) {
  if (playerHand === cpuHand) {
    return "draw";
  }

  return winMap[playerHand] === cpuHand ? "win" : "lose";
}

function setGameBusy(busy) {
  state.gameBusy = busy;
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
  const { withInvite = false, flowId = state.flowId } = options;

  if (state.scene !== "play" || !isFlowActive(flowId)) {
    return;
  }

  setGameBusy(true);
  setGestureArmed(false);
  hideAvatarHand();
  roundStatus.textContent = "じゅんび中";
  roundMessage.textContent = "さいしょは ぐー を きいてね!";

  if (withInvite) {
    await state.welcomePlayback;

    if (state.scene !== "play" || !isFlowActive(flowId)) {
      return;
    }

    setSpeech("じゃんけんで いっしょに あそぼう!");
    await playAudioAndWait("invite", INVITE_AUDIO_MS);
  }

  if (state.scene !== "play" || !isFlowActive(flowId)) {
    return;
  }

  setSpeech("さいしょは ぐー");
  roundStatus.textContent = "まっててね";
  roundMessage.textContent = "さいしょは ぐー の あとで てを みせてね!";
  await playAudioAndWait("janken", ROUND_PROMPT_MS);

  if (state.scene !== "play" || !isFlowActive(flowId)) {
    return;
  }

  roundStatus.textContent = "てを よんでるよ";
  roundMessage.textContent = "いま てを カメラに みせてね!";
  setSpeech("いま てを みせてね!");
  setGestureArmed(true);
  setGameBusy(false);
}

async function playRound(playerHand) {
  if (state.scene !== "play" || state.gameBusy) {
    return;
  }

  const flowId = state.flowId;
  setGameBusy(true);
  setGestureArmed(false);
  roundStatus.textContent = "しょうぶ中";
  roundMessage.textContent = `きみは ${hands[playerHand].name} を だしたよ!`;
  await wait(320);

  if (!isFlowActive(flowId) || state.scene !== "play") {
    return;
  }

  const cpuHand = pickCpuHand(playerHand);
  const result = judgeRound(playerHand, cpuHand);

  showAvatarHand(cpuHand);
  roundMessage.textContent = `${speechText[result]} きみ: ${hands[playerHand].name} / あいて: ${hands[cpuHand].name}`;
  roundStatus.textContent = outcomeText[result];
  updateScore(result);

  if (result === "win") {
    launchWinEffect();
    setSpeech(speechText.win);
    playAudio("win");
    await wait(Math.max(OUTCOME_EFFECT_MS, getAudioDurationMs("win", WIN_AUDIO_MS)));
  } else if (result === "lose") {
    launchLoseEffect();
    setSpeech(speechText.lose);
    playAudio("lose");
    await wait(Math.max(OUTCOME_EFFECT_MS, getAudioDurationMs("lose", LOSE_AUDIO_MS)));
  } else {
    setSpeech(speechText.draw);
    playAudio("draw");
    await wait(getAudioDurationMs("draw", DRAW_AUDIO_MS));
  }

  if (!isFlowActive(flowId) || state.scene !== "play") {
    return;
  }

  await primeRound({ flowId });
}

function resetExperience(keepCamera = true) {
  state.flowId += 1;
  state.hasPresence = false;
  state.consecutiveDetectedFrames = 0;
  state.consecutiveMissingFrames = 0;
  state.requestInFlight = false;
  state.gameBusy = false;
  state.debugMode = "off";
  state.welcomeEndsAt = 0;
  state.welcomePlayback = Promise.resolve();
  state.currentGestureCandidate = null;
  setGestureArmed(false);
  stopAllAudio();

  setScene("idle");
  hideAvatarHand();
  setSpeech(sceneContent.idle.speech);
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

  const flowId = state.flowId;
  state.audioArmed = true;
  setGestureArmed(false);
  setScene("play");
  roundMessage.textContent = "さいしょは ぐー を きいてね!";
  primeRound({ withInvite: true, flowId });
}

function applyDetectionPayload(payload) {
  const detections = Array.isArray(payload?.detections) ? payload.detections : [];
  state.detectorOnline = true;

  if (detections.length > 0) {
    state.consecutiveMissingFrames = 0;
    state.consecutiveDetectedFrames += 1;

    if (!state.hasPresence && state.consecutiveDetectedFrames >= WELCOME_FRAMES) {
      state.hasPresence = true;
      setScene("detected");
      setSpeech(sceneContent.detected.speech);
      state.welcomeEndsAt = Date.now() + getAudioDurationMs("welcome", WELCOME_AUDIO_MS);
      state.welcomePlayback = playAudioAndWait("welcome", WELCOME_AUDIO_MS);
    }

    if (state.hasPresence && state.consecutiveDetectedFrames >= PLAY_READY_FRAMES) {
      enterPlayScene();
    }
  } else {
    state.consecutiveDetectedFrames = 0;
    state.consecutiveMissingFrames += 1;

    if (state.hasPresence && state.consecutiveMissingFrames >= RESET_MISSING_FRAMES) {
      resetExperience(true);
    }
  }

  updateMeters();
  drawBoxes(detections, state.currentGestureCandidate);
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

  if (!state.gestureRecognizer) {
    try {
      await initGestureRecognizer();
    } catch {
      return;
    }
  }

  state.requestInFlight = true;

  try {
    const now = performance.now();
    const result = state.detector.detectForVideo(cameraVideo, now);
    const detections = buildDetectionsFromResult(result);
    applyDetectionPayload({ detections });

    const shouldTrackHands = state.hasPresence || state.scene === "play" || IS_EDIT_VIEW;

    if (shouldTrackHands) {
      const gestureResult = state.gestureRecognizer?.recognizeForVideo(cameraVideo, now);
      const gestureCandidate = extractGestureCandidate(gestureResult);
      updateGestureCandidate(gestureCandidate);
      drawBoxes(detections, state.currentGestureCandidate);
    } else {
      state.currentGestureCandidate = null;
      state.pendingGestureHand = null;
      state.pendingGestureFrames = 0;
      drawBoxes(detections, null);
    }
  } catch (error) {
    state.detectorOnline = false;
    updateMeters();
    showDetectorHint("AIの うごきが とまったよ");
    console.error(error);
  } finally {
    state.requestInFlight = false;
  }
}

startButton.addEventListener("click", () => {
  void unlockAudioPlayback();
  startCamera();
});

cameraPlaceholder.addEventListener("click", () => {
  void unlockAudioPlayback();
  if (!state.cameraReady && !state.cameraStarting) {
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
setSpeech(sceneContent.idle.speech);
updateCounters();
updateMeters();
setGameBusy(false);
showDetectorHint(getIdleHint());

if (IS_DISPLAY_VIEW) {
  setCameraPlaceholder("がめんをタップして はじめるよ", "カメラと おとを じゅんびするよ");
}

window.setInterval(requestDetections, SAMPLE_INTERVAL_MS);
