"""Local speech-to-text for the Telegram bridge (faster-whisper / CTranslate2).

Prints the transcript to stdout and keeps diagnostics on stderr, so the bridge
can use stdout verbatim as the prompt. The model is loaded from the local
Hugging Face cache (no network on a warm cache).

Usage:
    python transcribe.py <audio-file> [--model medium] [--language ru]
"""
import argparse
import sys


def main() -> int:
    # Windows consoles default to cp1252, which cannot encode Cyrillic: force
    # UTF-8 on both pipes so the transcript reaches the bridge intact.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - old/redirected streams may not support it
            pass

    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("file", help="audio file (ogg/opus/wav/mp3/flac)")
    parser.add_argument("--model", default="medium", help="model size or local dir")
    parser.add_argument("--language", default="ru", help="language code or 'auto'")
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    parser.add_argument("--compute-type", default="int8", help="CTranslate2 compute type")
    parser.add_argument(
        "--threads",
        type=int,
        default=0,
        help="CPU threads (0 = let CTranslate2 decide)",
    )
    parser.add_argument(
        "--beam",
        type=int,
        default=1,
        help="beam size: 1 = greedy (fast), 5 = more accurate but ~2x slower",
    )
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001 - report, never traceback into stdout
        print(f"faster_whisper unavailable: {exc}", file=sys.stderr)
        return 2

    language = None if args.language in ("", "auto", "None") else args.language
    try:
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type,
            num_workers=1,
            cpu_threads=args.threads,
        )
        segments, info = model.transcribe(
            args.file,
            language=language,
            beam_size=args.beam,
            # Greedy decoding has no beam to search, so the fallback knobs that
            # make beam search slow are pointless; temperature 0 keeps it stable.
            temperature=0.0,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
            condition_on_previous_text=False,
        )
        print(
            f"lang={getattr(info, 'language', '?')} "
            f"prob={getattr(info, 'language_probability', 0):.2f} "
            f"dur={getattr(info, 'duration', 0):.1f}s",
            file=sys.stderr,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
    except Exception as exc:  # noqa: BLE001
        print(f"transcribe failed: {exc}", file=sys.stderr)
        return 1

    sys.stdout.write(text.strip() + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
