"""Бейне -> субтитр (WebVTT) через Whisper (faster-whisper).
Бесплатно, API-кілт қажет емес. Қолдану:  python subtitles.py demo.webm
Алдын ала талап: pip install imageio-ffmpeg (ffmpeg бинарын береді)
"""
import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import imageio_ffmpeg
from faster_whisper import WhisperModel


@lru_cache(maxsize=2)
def get_model(model_size: str) -> WhisperModel:
    # Модель бір рет жүктеледі де, кейін қайта қолданылады
    return WhisperModel(model_size, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)


def fmt(t: float) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02}:{int(m):02}:{s:06.3f}"


def load_audio(path: str, sr: int = 16000) -> np.ndarray:
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-i", path,
           "-f", "s16le", "-ac", "1", "-ar", str(sr), "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def transcribe(video_path: str, model_size: str = "medium", lang: str | None = None) -> str:
    model = get_model(model_size)
    segments, info = model.transcribe(load_audio(video_path), language=lang, vad_filter=True, beam_size=5, condition_on_previous_text=False)

    lines = ["WEBVTT", ""]
    for i, seg in enumerate(segments, 1):
        lines += [str(i), f"{fmt(seg.start)} --> {fmt(seg.end)}", seg.text.strip(), ""]

    out = Path(video_path).with_suffix(".vtt")
    out.write_text("\n".join(lines), encoding="utf-8")
    out.with_suffix(".lang").write_text(info.language or "", encoding="utf-8")
    return str(out)


if __name__ == "__main__":
    print("Сақталды:", transcribe(sys.argv[1], model_size="medium", lang="kk"))
