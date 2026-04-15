#!/usr/bin/env python3
"""Transcribe audio with faster-whisper, then force-align with WhisperX.

Outputs a single canonical Transcript JSON object on stdout. Progress and
diagnostics go to stderr so the Node caller can stream them through.

Environment:
  WHISPER_MODEL  Whisper model name (default: large-v3). Use "base" or
                 "small" for fast CPU smoke tests; "large-v3" for prod.

Usage: transcribe.py <audio.wav> <output.json> [--no-vad]

The output JSON is written to <output.json> rather than stdout because some
PyTorch helpers (e.g. the model downloader) write progress text to stdout
and would contaminate a stdout-based protocol. Stdout/stderr are reserved
for free-form logs the Node caller can stream through.

VAD: Silero VAD is ON by default (faster, fewer hallucinations). Pass
--no-vad to disable it when the default pass returns zero speech —
useful for speaker clips that VAD incorrectly filters to silence.
"""
from __future__ import annotations

import json
import os
import sys


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main() -> None:
    # Positional: audio_path, output_path. Optional flag: --no-vad.
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) != 2:
        log("usage: transcribe.py <audio.wav> <output.json> [--no-vad]")
        sys.exit(2)
    audio_path, output_path = args
    vad_filter = "--no-vad" not in flags

    # Lazy imports so an import-time failure surfaces with a real error
    # message instead of crashing before we can log anything useful.
    import torch
    from faster_whisper import WhisperModel
    import whisperx

    if torch.cuda.is_available():
        device = "cuda"
        compute_type = "float16"
    else:
        device = "cpu"
        compute_type = "int8"

    model_name = os.environ.get("WHISPER_MODEL", "large-v3")
    log(f"device={device} compute_type={compute_type} model={model_name}")

    log(f"loading whisper {model_name}...")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    log(f"transcribing (vad_filter={vad_filter})...")
    segments_iter, info = model.transcribe(
        audio_path,
        beam_size=5,
        vad_filter=vad_filter,
        word_timestamps=False,
    )
    segments = [
        {"start": float(s.start), "end": float(s.end), "text": s.text}
        for s in segments_iter
    ]
    log(f"transcribed {len(segments)} segments, language={info.language}")

    log("loading alignment model...")
    align_model, metadata = whisperx.load_align_model(
        language_code=info.language, device=device
    )

    log("aligning...")
    aligned = whisperx.align(
        segments,
        align_model,
        metadata,
        audio_path,
        device,
        return_char_alignments=False,
    )

    words = []
    for seg in aligned.get("segments", []):
        for w in seg.get("words", []):
            if "start" not in w or "end" not in w:
                # Words the aligner couldn't pin to the audio (rare,
                # usually filler tokens). Skip — they would break the
                # render timeline if we kept them with bogus timestamps.
                continue
            words.append(
                {
                    "word": str(w["word"]).strip(),
                    "start": float(w["start"]),
                    "end": float(w["end"]),
                    "confidence": float(w.get("score", 1.0)),
                }
            )

    out = {
        "language": info.language,
        "duration": float(info.duration),
        "words": words,
    }
    with open(output_path, "w") as f:
        json.dump(out, f)
    log(f"done: {len(words)} words -> {output_path}")


if __name__ == "__main__":
    main()
