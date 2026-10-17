from __future__ import annotations

from pathlib import Path


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
    return sorted(path.name for path in audio_dir.iterdir() if path.is_file() and path.suffix.lower() in (".mp3", ".wav"))