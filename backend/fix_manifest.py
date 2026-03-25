import json
import os

def fix():
    with open("assets/raw_transcript.json", "r") as f:
        words = json.load(f)

    with open("assets/manifest.json", "r") as f:
        manifest = json.load(f)
        
    gpt_captions = manifest["sequence"]

    final_sequence = []
    for w in words:
        w_start = w['start']
        matching_caption = gpt_captions[0] if gpt_captions else None
        if matching_caption:
            for cap in reversed(gpt_captions):
                # We use +0.5 to account for slight GPT rounding of float timestamps
                if cap['timestamp_start'] <= w_start + 0.5:
                    matching_caption = cap
                    break
                
        if matching_caption:
            # We map the specific word, but keep the style assigned to the phrase
            final_sequence.append({
                "timestamp_start": w['start'],
                "text": w['word'],
                "style": matching_caption.get('style', 'style_basic_white'),
                "b_roll_search_term": matching_caption.get('b_roll_search_term'),
                "local_b_roll_path": matching_caption.get('local_b_roll_path')
            })

    merged = {"sequence": final_sequence}

    with open("assets/manifest.json", "w") as f:
        json.dump(merged, f, indent=2)

    with open(os.path.join("..", "renderer", "src", "mock_manifest.json"), "w") as f:
        json.dump(merged, f, indent=2)

    print("Manifest mapped to word-level successfully!")

if __name__ == "__main__":
    fix()
