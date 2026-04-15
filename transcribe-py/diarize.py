#!/usr/bin/env python3
"""Speaker diarization for producer pipeline.

Returns per-speaker time segments so the orchestrator can pick clips where
a main speaker is visible/talking and the mode detector can decide between
speaker_montage and narrated_story.

We piggyback on whisperx's diarization pipeline (pyannote.audio under the
hood) because whisperx is already a runtime dep of transcribe.py. This
means diarize.py works out of the box on any machine where transcribe.py
works — no extra packages to install.

Environment:
  HUGGINGFACE_TOKEN   Required by pyannote to fetch the diarization model.
                      If unset, the script writes an empty result and exits 0
                      — the pipeline treats diarization as best-effort.
  DIARIZE_MIN_SPK     Optional min speakers hint (default: unset)
  DIARIZE_MAX_SPK     Optional max speakers hint (default: unset)

Usage: diarize.py <audio.wav> <output.json>

Output schema:
  {
    "segments": [{"start": float, "end": float, "speaker": "SPEAKER_00"}, ...],
    "speakerCount": int
  }
"""
from __future__ import annotations

import json
import os
import sys


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def write_empty(output_path: str, reason: str) -> None:
    log(f"diarize: writing empty result ({reason})")
    with open(output_path, "w") as f:
        json.dump({"segments": [], "speakerCount": 0}, f)


def main() -> None:
    if len(sys.argv) != 3:
        log("usage: diarize.py <audio.wav> <output.json>")
        sys.exit(2)
    audio_path = sys.argv[1]
    output_path = sys.argv[2]

    hf_token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    if not hf_token:
        # Soft-fail: producer pipeline treats missing diarization as a
        # normal fallback and uses time-based heuristics instead.
        write_empty(output_path, "no HUGGINGFACE_TOKEN")
        return

    try:
        import torch
        import whisperx
    except Exception as e:
        write_empty(output_path, f"import failed: {e}")
        return

    device = "cuda" if torch.cuda.is_available() else "cpu"
    log(f"diarize: device={device}")

    try:
        # whisperx.DiarizationPipeline wraps pyannote's
        # speaker-diarization-3.1 model. It requires the user to have
        # accepted the model's license on HuggingFace and set a token.
        diarize_model = whisperx.DiarizationPipeline(
            use_auth_token=hf_token,
            device=device,
        )

        kwargs = {}
        min_spk = os.environ.get("DIARIZE_MIN_SPK")
        max_spk = os.environ.get("DIARIZE_MAX_SPK")
        if min_spk:
            kwargs["min_speakers"] = int(min_spk)
        if max_spk:
            kwargs["max_speakers"] = int(max_spk)

        log("diarize: running pipeline...")
        diarize_df = diarize_model(audio_path, **kwargs)
    except Exception as e:
        write_empty(output_path, f"pipeline failed: {e}")
        return

    # diarize_df is a pandas DataFrame with columns: segment, label, speaker, start, end
    segments = []
    speakers = set()
    try:
        for _, row in diarize_df.iterrows():
            seg = {
                "start": float(row["start"]),
                "end": float(row["end"]),
                "speaker": str(row["speaker"]),
            }
            segments.append(seg)
            speakers.add(seg["speaker"])
    except Exception as e:
        write_empty(output_path, f"dataframe parse failed: {e}")
        return

    out = {"segments": segments, "speakerCount": len(speakers)}
    with open(output_path, "w") as f:
        json.dump(out, f)
    log(f"diarize: {len(segments)} segments, {len(speakers)} speakers -> {output_path}")


if __name__ == "__main__":
    main()
