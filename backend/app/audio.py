# BEL Cyber Network Operations Status — safe local audio file handling.
from __future__ import annotations

import io
import math
from pathlib import Path

from mutagen import MutagenError
from mutagen.mp3 import MP3
from mutagen.wave import WAVE

MAX_AUDIO_DURATION_SECONDS = 60


def validate_audio_duration(source: bytes | Path, filename: str | None = None) -> float:
    try:
        path = source if isinstance(source, Path) else Path(filename or "")
        extension = path.suffix.lower()
        audio_file = io.BytesIO(source) if isinstance(source, bytes) else source
        if extension == ".wav":
            audio = WAVE(audio_file)
        elif extension == ".mp3":
            audio = MP3(audio_file)
        else:
            raise ValueError("Only MP3 and WAV audio files are supported")
        duration = float(audio.info.length)
    except (EOFError, MutagenError, OSError, TypeError, ValueError) as error:
        raise ValueError("Audio must be a valid MP3 or WAV file") from error
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Audio duration could not be determined")
    if duration > MAX_AUDIO_DURATION_SECONDS:
        raise ValueError(f"Audio must not exceed {MAX_AUDIO_DURATION_SECONDS} seconds")
    return duration


def audio_upload_path(audio_dir: Path, filename: str) -> Path:
    if not filename or Path(filename).name != filename or "/" in filename or "\\" in filename or filename in (".", ".."):
        raise ValueError("Invalid audio filename")
    if Path(filename).suffix.lower() not in (".mp3", ".wav"):
        raise ValueError("Only MP3 and WAV files are supported")
    root = audio_dir.resolve()
    candidate = (root / filename).resolve()
    if candidate.parent != root:
        raise ValueError("Invalid audio filename")
    return candidate


def safe_audio_file(audio_dir: Path, filename: str) -> Path:
    if not filename or filename != Path(filename).name or filename in (".", ".."):
        raise ValueError("Invalid audio filename")
    if Path(filename).suffix.lower() not in (".mp3", ".wav"):
        raise ValueError("Only MP3 and WAV files are supported")
    root = audio_dir.resolve()
    candidate = (root / filename).resolve()
    if candidate.parent != root or not candidate.is_file():
        raise FileNotFoundError(filename)
    return candidate


def list_audio_files(audio_dir: Path) -> list[str]:
    if not audio_dir.exists():
        return []
    files = []
    for path in audio_dir.iterdir():
        if not path.is_file() or path.suffix.lower() not in (".mp3", ".wav"):
            continue
        try:
            validate_audio_duration(path)
        except ValueError:
            continue
        files.append(path.name)
    return sorted(files)