"""Local face enrollment, blink liveness cue, and identity matching service."""

import base64
import binascii
import hmac
import io
import json
import math
import os
import statistics
import sqlite3
import time
from contextlib import closing
from pathlib import Path

import face_recognition
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("FACE_DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "templates.sqlite"
TEMPLATE_KEY_HEX = os.environ.get("FACE_TEMPLATE_KEY", "")
FACE_SERVICE_TOKEN = os.environ.get("FACE_SERVICE_TOKEN", "")
PRODUCTION = os.environ.get("NODE_ENV") == "production"
if PRODUCTION and len(FACE_SERVICE_TOKEN) < 32:
    raise RuntimeError("Configure a private FACE_SERVICE_TOKEN with at least 32 characters.")
if PRODUCTION and (not os.environ.get("FACE_DATA_DIR") or not Path(DATA_DIR).is_absolute()):
    raise RuntimeError("Production FACE_DATA_DIR must point to an absolute persistent-storage path.")

app = FastAPI(title="Smart Attendance Face Service", docs_url=None, redoc_url=None)


def require_backend(authorization: str | None = Header(default=None)) -> None:
    if not FACE_SERVICE_TOKEN and not PRODUCTION:
        return
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not hmac.compare_digest(supplied.encode("utf-8"), FACE_SERVICE_TOKEN.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Backend service authentication is required.")


class Enrollment(BaseModel):
    studentId: str = Field(min_length=1, max_length=32)
    image: str = Field(min_length=20, max_length=1_500_000)


class Verification(BaseModel):
    studentId: str = Field(min_length=1, max_length=32)
    frames: list[str] = Field(min_length=10, max_length=42)
    promptFrame: int = Field(ge=4, le=5)


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS face_templates (student_id TEXT PRIMARY KEY, encoding BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    return connection


def template_cipher() -> AESGCM:
    try:
        # Accept the existing 64-character hex keys and Render's generated
        # URL-safe base64 secrets (32 random bytes) without storing either in code.
        key = bytes.fromhex(TEMPLATE_KEY_HEX)
    except ValueError:
        try:
            key = base64.urlsafe_b64decode(TEMPLATE_KEY_HEX + "=" * (-len(TEMPLATE_KEY_HEX) % 4))
        except (ValueError, binascii.Error):
            key = b""
    if len(key) != 32:
        raise HTTPException(status_code=503, detail="Face template encryption is not configured.")
    return AESGCM(key)


if PRODUCTION:
    template_cipher()


def encrypt_template(student_id: str, encoding: np.ndarray) -> bytes:
    nonce = os.urandom(12)
    ciphertext = template_cipher().encrypt(nonce, json.dumps(encoding.tolist()).encode(), student_id.encode())
    return nonce + ciphertext


def decrypt_template(student_id: str, encrypted: bytes) -> np.ndarray:
    if len(encrypted) < 29:
        raise HTTPException(status_code=500, detail="Stored face template is invalid.")
    decoded = template_cipher().decrypt(encrypted[:12], encrypted[12:], student_id.encode())
    return np.asarray(json.loads(decoded), dtype=np.float64)


def image_array(data_url: str, max_size: int = 640) -> np.ndarray:
    try:
        encoded = data_url.split(",", 1)[1] if "," in data_url else data_url
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 750_000:
            raise HTTPException(status_code=413, detail="Image is too large.")
        with Image.open(io.BytesIO(raw)) as image:
            image = image.convert("RGB")
            image.thumbnail((max_size, max_size))
            return np.asarray(image)
    except (IndexError, binascii.Error, UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="A valid image is required.") from None


def face_encoding(data_url: str) -> np.ndarray:
    image = image_array(data_url)
    locations = face_recognition.face_locations(image, model="hog")
    if len(locations) != 1:
        raise HTTPException(status_code=422, detail="Show exactly one clear face to the camera.")
    encodings = face_recognition.face_encodings(image, known_face_locations=locations, num_jitters=1)
    if len(encodings) != 1:
        raise HTTPException(status_code=422, detail="The face could not be analyzed. Improve the lighting and try again.")
    return encodings[0]


def eye_aspect_ratio(points: list[tuple[int, int]]) -> float:
    """Measure eye openness from the six landmarks returned by dlib."""
    if len(points) != 6:
        return 0.0
    vertical_a = math.dist(points[1], points[5])
    vertical_b = math.dist(points[2], points[4])
    horizontal = math.dist(points[0], points[3])
    return (vertical_a + vertical_b) / (2.0 * horizontal) if horizontal else 0.0


def frame_eyes(data_url: str):
    # Keep the sampled camera frame at full capture resolution for identity matching.
    image = image_array(data_url, max_size=480)
    locations = face_recognition.face_locations(image, model="hog")
    if len(locations) != 1:
        return None
    landmarks = face_recognition.face_landmarks(image, face_locations=locations)
    if len(landmarks) != 1:
        return None
    left = landmarks[0].get("left_eye", [])
    right = landmarks[0].get("right_eye", [])
    if len(left) != 6 or len(right) != 6:
        return None
    return (eye_aspect_ratio(left), eye_aspect_ratio(right)), image, locations[0]


def fail(status: int, message: str):
    raise HTTPException(status_code=status, detail=message)


@app.get("/enrolled/{student_id}")
def enrolled(student_id: str, _auth: None = Depends(require_backend)):
    with closing(connect()) as connection:
        exists = connection.execute("SELECT 1 FROM face_templates WHERE student_id=?", (student_id,)).fetchone()
    return {"enrolled": bool(exists)}


@app.post("/enroll")
def enroll(request: Enrollment, _auth: None = Depends(require_backend)):
    encoding = face_encoding(request.image)
    with closing(connect()) as connection:
        connection.execute(
            "INSERT INTO face_templates(student_id, encoding) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET encoding=excluded.encoding, updated_at=CURRENT_TIMESTAMP",
            (request.studentId, encrypt_template(request.studentId, encoding)),
        )
        connection.commit()
    return {"enrolled": True}


@app.post("/verify")
def verify(request: Verification, _auth: None = Depends(require_backend)):
    started = time.perf_counter()
    with closing(connect()) as connection:
        row = connection.execute("SELECT encoding FROM face_templates WHERE student_id=?", (request.studentId,)).fetchone()
    if not row:
        fail(409, "No face enrollment exists for this account.")
    enrolled = decrypt_template(request.studentId, row[0])
    measurements = []
    for index, frame in enumerate(request.frames):
        try:
            result = frame_eyes(frame)
        except HTTPException:
            result = None
        measurements.append((index, result))

    baseline = [result[0] for index, result in measurements if index < request.promptFrame and result is not None]
    if len(baseline) < 3:
        fail(422, "Keep one clear face centered in the camera before blinking.")
    baseline_left = statistics.median(value[0] for value in baseline)
    baseline_right = statistics.median(value[1] for value in baseline)
    if min(baseline_left, baseline_right) < 0.12:
        fail(422, "Keep both eyes open and visible before the blink prompt.")

    saw_closed = False
    candidates = []
    last_candidate_index = -2
    for index, result in measurements:
        if index < request.promptFrame or result is None:
            continue
        (left, right), image, location = result
        left_ratio = left / baseline_left
        right_ratio = right / baseline_right
        open_eyes = left_ratio >= 0.80 and right_ratio >= 0.80
        closed_eyes = (left_ratio + right_ratio) / 2 <= 0.78
        if closed_eyes:
            saw_closed = True
        elif saw_closed and open_eyes and index - last_candidate_index >= 2:
            candidates.append((image, location))
            last_candidate_index = index

    if not candidates:
        if saw_closed:
            fail(422, "Blink detected. Keep both eyes open after the prompt and try again.")
        fail(422, "Blink not detected. Close both eyes naturally once when the prompt appears.")
    landmark_seconds = time.perf_counter() - started
    distances = []
    for image, location in candidates[:5]:
        encodings = face_recognition.face_encodings(image, known_face_locations=[location], num_jitters=1)
        if len(encodings) == 1:
            distances.append(float(face_recognition.face_distance([enrolled], encodings[0])[0]))
    if len(distances) < 3:
        fail(422, "Keep your face centered and clearly visible after blinking.")
    median_distance = float(np.median(distances))
    matching_frames = sum(distance <= 0.50 for distance in distances)
    if median_distance > 0.50 or matching_frames < 3:
        fail(403, "The face does not match the student enrollment.")
    print(
        "Face verification completed: "
        f"{len(request.frames)} frames, {len(measurements)} sampled, "
        f"landmarks {landmark_seconds:.2f}s, "
        f"total {time.perf_counter() - started:.2f}s",
        flush=True,
    )
    return {"verified": True, "blinkVerified": True}


@app.get("/health")
def health():
    return {"status": "ok"}
