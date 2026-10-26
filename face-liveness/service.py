"""Local face enrollment and identity matching service."""

import base64
import binascii
import io
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path

import face_recognition
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("FACE_DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "templates.sqlite"
TEMPLATE_KEY_HEX = os.environ.get("FACE_TEMPLATE_KEY", "")

app = FastAPI(title="Smart Attendance Face Service", docs_url=None, redoc_url=None)


class Enrollment(BaseModel):
    studentId: str = Field(min_length=1, max_length=32)
    image: str = Field(min_length=20, max_length=1_500_000)


class Verification(BaseModel):
    studentId: str = Field(min_length=1, max_length=32)
    image: str = Field(min_length=20, max_length=1_500_000)


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS face_templates (student_id TEXT PRIMARY KEY, encoding BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    return connection


def template_cipher() -> AESGCM:
    try:
        key = bytes.fromhex(TEMPLATE_KEY_HEX)
    except ValueError:
        key = b""
    if len(key) != 32:
        raise HTTPException(status_code=503, detail="Face template encryption is not configured.")
    return AESGCM(key)


def encrypt_template(student_id: str, encoding: np.ndarray) -> bytes:
    nonce = os.urandom(12)
    ciphertext = template_cipher().encrypt(nonce, json.dumps(encoding.tolist()).encode(), student_id.encode())
    return nonce + ciphertext


def decrypt_template(student_id: str, encrypted: bytes) -> np.ndarray:
    if len(encrypted) < 29:
        raise HTTPException(status_code=500, detail="Stored face template is invalid.")
    decoded = template_cipher().decrypt(encrypted[:12], encrypted[12:], student_id.encode())
    return np.asarray(json.loads(decoded), dtype=np.float64)


def image_array(data_url: str) -> np.ndarray:
    try:
        encoded = data_url.split(",", 1)[1] if "," in data_url else data_url
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 750_000:
            raise HTTPException(status_code=413, detail="Image is too large.")
        with Image.open(io.BytesIO(raw)) as image:
            image = image.convert("RGB")
            image.thumbnail((640, 640))
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


def fail(status: int, message: str):
    raise HTTPException(status_code=status, detail=message)


@app.get("/enrolled/{student_id}")
def enrolled(student_id: str):
    with closing(connect()) as connection:
        exists = connection.execute("SELECT 1 FROM face_templates WHERE student_id=?", (student_id,)).fetchone()
    return {"enrolled": bool(exists)}


@app.post("/enroll")
def enroll(request: Enrollment):
    encoding = face_encoding(request.image)
    with closing(connect()) as connection:
        connection.execute(
            "INSERT INTO face_templates(student_id, encoding) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET encoding=excluded.encoding, updated_at=CURRENT_TIMESTAMP",
            (request.studentId, encrypt_template(request.studentId, encoding)),
        )
        connection.commit()
    return {"enrolled": True}


@app.post("/verify")
def verify(request: Verification):
    with closing(connect()) as connection:
        row = connection.execute("SELECT encoding FROM face_templates WHERE student_id=?", (request.studentId,)).fetchone()
    if not row:
        fail(409, "No face enrollment exists for this account.")
    enrolled = decrypt_template(request.studentId, row[0])
    encoding = face_encoding(request.image)
    if float(face_recognition.face_distance([enrolled], encoding)[0]) > 0.50:
        fail(403, "The face does not match the student enrollment.")
    return {"verified": True}


@app.get("/health")
def health():
    return {"status": "ok"}
