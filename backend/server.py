from __future__ import annotations

import os
import time
from collections import deque
from pathlib import Path
from threading import Lock

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
CACHE_ROOT = ROOT / ".runtime"
YOLO_CONFIG_DIR = CACHE_ROOT / "ultralytics"
MPL_CONFIG_DIR = CACHE_ROOT / "matplotlib"
XDG_CACHE_HOME = CACHE_ROOT / "xdg"

for directory in (YOLO_CONFIG_DIR, MPL_CONFIG_DIR, XDG_CACHE_HOME):
  directory.mkdir(parents=True, exist_ok=True)

os.environ.setdefault("YOLO_CONFIG_DIR", str(YOLO_CONFIG_DIR))
os.environ.setdefault("MPLCONFIGDIR", str(MPL_CONFIG_DIR))
os.environ.setdefault("XDG_CACHE_HOME", str(XDG_CACHE_HOME))

from ultralytics import YOLO


MODEL_NAME = os.environ.get("YOLO_MODEL", "yolo26n.pt")
CONTROL_ACTIONS = {"start_camera", "reset", "sound_test", "play_hand"}

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
model = YOLO(MODEL_NAME)

state_lock = Lock()
command_log: deque[dict] = deque(maxlen=200)
command_sequence = 0
display_status = {
  "scene": "idle",
  "cameraReady": False,
  "detectorOnline": False,
  "hasPresence": False,
  "gameBusy": False,
  "roundStatus": "まだ まってるよ",
  "roundMessage": "カメラの まえに きてね!",
  "score": {"wins": 0, "draws": 0, "losses": 0, "streak": 0},
  "updatedAt": 0.0,
}


def detect_people(image: Image.Image) -> list[dict]:
  rgb = image.convert("RGB")
  frame = np.array(rgb)
  width, height = rgb.size

  results = model.predict(
    source=frame,
    classes=[0],
    conf=0.35,
    imgsz=640,
    verbose=False,
  )

  people = []
  for box in results[0].boxes:
    x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
    box_width = max(0.0, x2 - x1)
    box_height = max(0.0, y2 - y1)
    area_ratio = (box_width * box_height) / (width * height)

    people.append(
      {
        "label": "person",
        "confidence": round(float(box.conf[0]), 3),
        "areaRatio": round(area_ratio, 4),
        "bbox": {
          "x": round(x1 / width, 4),
          "y": round(y1 / height, 4),
          "width": round(box_width / width, 4),
          "height": round(box_height / height, 4),
        },
      }
    )

  people.sort(key=lambda item: item["areaRatio"], reverse=True)
  return people


@app.get("/api/health")
def health() -> tuple[dict, int]:
  return {"ok": True, "model": MODEL_NAME}, 200


@app.post("/api/detect")
def detect() -> tuple[dict, int]:
  frame = request.files.get("frame")
  if frame is None:
    return {"error": "frame file is required"}, 400

  image = Image.open(frame.stream)
  detections = detect_people(image)
  return {
    "detectorOnline": True,
    "source": "ultralytics",
    "detections": detections,
  }, 200


@app.post("/api/display/status")
def update_display_status() -> tuple[dict, int]:
  payload = request.get_json(silent=True) or {}
  score = payload.get("score") if isinstance(payload.get("score"), dict) else {}

  with state_lock:
    display_status.update(
      {
        "scene": payload.get("scene", display_status["scene"]),
        "cameraReady": bool(payload.get("cameraReady", display_status["cameraReady"])),
        "detectorOnline": bool(payload.get("detectorOnline", display_status["detectorOnline"])),
        "hasPresence": bool(payload.get("hasPresence", display_status["hasPresence"])),
        "gameBusy": bool(payload.get("gameBusy", display_status["gameBusy"])),
        "roundStatus": payload.get("roundStatus", display_status["roundStatus"]),
        "roundMessage": payload.get("roundMessage", display_status["roundMessage"]),
        "score": {
          "wins": int(score.get("wins", display_status["score"]["wins"])),
          "draws": int(score.get("draws", display_status["score"]["draws"])),
          "losses": int(score.get("losses", display_status["score"]["losses"])),
          "streak": int(score.get("streak", display_status["score"]["streak"])),
        },
        "updatedAt": time.time(),
      }
    )

  return {"ok": True}, 200


@app.get("/api/display/status")
def read_display_status() -> tuple[dict, int]:
  with state_lock:
    payload = dict(display_status)
    payload["score"] = dict(display_status["score"])

  return payload, 200


@app.post("/api/control/command")
def enqueue_control_command() -> tuple[dict, int]:
  global command_sequence

  payload = request.get_json(silent=True) or {}
  action = payload.get("action")

  if action not in CONTROL_ACTIONS:
    return {"error": "unsupported action"}, 400

  command = {
    "id": 0,
    "action": action,
    "hand": payload.get("hand"),
    "createdAt": time.time(),
  }

  with state_lock:
    command_sequence += 1
    command["id"] = command_sequence
    command_log.append(command)

  return {"ok": True, "command": command}, 200


@app.get("/api/control/commands")
def read_control_commands() -> tuple[dict, int]:
  after_id = int(request.args.get("after", "0"))

  with state_lock:
    commands = [dict(command) for command in command_log if command["id"] > after_id]

  return {"commands": commands}, 200


@app.get("/")
@app.get("/display")
def display_index() -> object:
  return send_from_directory(ROOT, "index.html")


@app.get("/edit")
def edit_index() -> object:
  return send_from_directory(ROOT, "index.html")


@app.get("/control")
def control_index() -> object:
  return send_from_directory(ROOT, "control.html")


@app.get("/<path:asset_path>")
def assets(asset_path: str) -> object:
  return send_from_directory(ROOT, asset_path)


if __name__ == "__main__":
  host = os.environ.get("HOST", "0.0.0.0")
  port = int(os.environ.get("PORT", "8000"))
  app.run(host=host, port=port, debug=False)
