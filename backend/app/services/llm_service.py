import logging
import base64
import os
import json

client = None

def init_llm_service(openai_client):
    global client
    client = openai_client

def encode_image(image_path: str):
    """Encodes an image to base64."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def extract_style_config(image_paths: list[str]):
    """Analyzes reference images using GPT-4o Vision API to extract typographic and color styles."""
    logging.info(f"Extracting style from {len(image_paths)} reference images")
    
    content_parts = []
    for image_path in image_paths:
        if image_path.startswith("http://") or image_path.startswith("https://"):
            image_payload = { "url": image_path }
        else:
            base64_image = encode_image(image_path)
            ext = os.path.splitext(image_path)[1].lower()
            mime = "image/png" if ext == ".png" else "image/jpeg"
            image_payload = { "url": f"data:{mime};base64,{base64_image}" }
            
        content_parts.append({
            "type": "image_url",
            "image_url": image_payload
        })

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            response_format={ "type": "json_object" },
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert graphic designer and UI extractor. Your task is to analyze the provided design reference images "
                        "and extract ALL distinct typographic styles present, as well as the overall visual theme. "
                        "Return a strictly formatted JSON object where one key is 'global_theme' (a string describing the overall aesthetic theme of the image, e.g., 'cartoon animation', 'vintage film', 'cyberpunk'). "
                        "The other keys must be 'style_1', 'style_2', 'style_3' etc. (extract up to 3 distinct styles). "
                        "Each style object must have: "
                        "'primaryColor' (hex), 'backgroundColor' (hex of any bounding box/pill behind the text, or null), "
                        "'alternateColors' (Array of hex codes. CRITICAL: Look closely at the letters in a single word. If consecutive letters alternate in color, list those alternating colors here. If all letters are the same color, leave this empty), "
                        "'fontFamily' (a generic web-safe font like 'Impact', 'Comic Sans', 'Inter', 'Bangers'), "
                        "'fontWeight' (integer like 400, 700, 900), 'textTransform' (uppercase, lowercase, none), "
                        "'textShadow' (CSS string e.g. '4px 4px 0px #000' or '-4px -8px 0px #000'. CAREFULLY observe the direction of the shadow! If the shadow is ABOVE the text, the Y offset MUST be negative. If the shadow is to the LEFT, the X offset MUST be negative. Include multiple shadows separated by commas if stacked!), "
                        "and 'textStroke' (CSS webkit stroke e.g. '4px #000000' or null). "
                        "Pay close attention to thin borders around the text and make sure they are included in textStroke, and pay close attention to multiple thick block shadows behind the text."
                    )
                },
                {
                    "role": "user",
                    "content": content_parts
                }
            ]
        )
        
        style_config = json.loads(response.choices[0].message.content)
        
        # Enforce structure in case LLM outputs an array instead of flat keys
        if "styles" in style_config and isinstance(style_config["styles"], list):
            for i, st_obj in enumerate(style_config["styles"]):
                style_config[f"style_{i+1}"] = st_obj
                
        logging.info("Successfully extracted style config from image.")
        return style_config
    except Exception as e:
        logging.error(f"Error extracting style config from image: {e}")
        return None

def generate_styling_manifest(words: list, user_prompt: str = None, style_config: dict = None, global_theme: str = None):
    """Passes the transcript to GPT-4o to generate styling and b-roll suggestions."""
    logging.info("Calling GPT-4o to generate styling manifest...")
    
    transcript_text = "\n".join([f"[{w['start']:.2f}] {w['word']}" for w in words])
    available_styles = [k for k in style_config.keys() if k.startswith('style_')] if style_config else ['style_basic_white']
    
    system_content = (
        "You are an expert video editor. Output a JSON object with a single key 'captions' containing an array. "
        f"Each object must have: 'timestamp_start' (float), 'text' (string), 'style' (MUST be one of these strings: {', '.join(available_styles)} chosen intelligently based on the emotion or emphasis of the word vs the others), "
        "and 'b_roll_search_term' (string or null). "
        "Add b_roll_search_term for grand, aesthetic concepts matching the emotion."
    )
    
    if global_theme:
        system_content += f"\n\nCRITICAL THEMATIC DIRECTION: The reference image has a visual theme of '{global_theme}'. Incorporate this theme intelligently into the b_roll_search_term appropriately so the returned videos match the aesthetic."
    
    if user_prompt:
        system_content += f"\n\nCRITICAL CREATIVE DIRECTION FROM USER: '{user_prompt}'. Incorporate these requests into the b_roll_search_term appropriately if they dictate specific themes or footage."
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            response_format={ "type": "json_object" },
            messages=[
                {
                    "role": "system",
                    "content": system_content
                },
                {"role": "user", "content": transcript_text}
            ]
        )
        
        manifest = json.loads(response.choices[0].message.content)
        return manifest.get("captions", [])
    except Exception as e:
        logging.error(f"Error calling LLM: {e}")
        return []

def evaluate_broll_options(videos: list, context_prompt: str, text_color_hex: str = None):
    """Uses GPT-4o Vision to select the best video from a list of Pexels videos."""
    if not videos or len(videos) <= 1:
        return 0
        
    logging.info(f"Sub-Agent evaluating {len(videos)} B-Roll thumbnails for contrast against {text_color_hex}...")
    
    prompt_text = (
        "You are a creative director sub-agent. "
        "Review these video thumbnails and select the one that represents the highest quality, most 'cool' aesthetic, "
        f"and fits this context: '{context_prompt}'. "
    )
    if text_color_hex:
        prompt_text += (
            f"CRITICAL READABILITY CHECK: The text rendered over the center of this video will be colored {text_color_hex}. "
            "You MUST evaluate human readability! Absolutely AVOID any thumbnails where the focal background matches or blends with "
            f"the {text_color_hex} color, as it will camouflage the words. Pick a video that offers strong visual contrast against {text_color_hex} text. "
        )
    prompt_text += (
        "AVOID generic, poor quality, or 'trash' scenes. Pick the one that looks most cinematic and interesting. "
        "Return ONLY a strictly formatted JSON object with a single key 'best_index' containing the integer index (0-based) of the best video thumbnail."
    )
    
    content_parts = [{"type": "text", "text": prompt_text}]
    
    for i, v in enumerate(videos):
        img_url = v.get("image")
        if img_url:
            content_parts.append({"type": "text", "text": f"Thumbnail Index {i}:"})
            content_parts.append({"type": "image_url", "image_url": { "url": img_url }})
            
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            response_format={ "type": "json_object" },
            messages=[{"role": "user", "content": content_parts}]
        )
        content = response.choices[0].message.content
        if not content:
            return 0
        result = json.loads(content)
        best_index = result.get("best_index", 0)
        
        if isinstance(best_index, int) and 0 <= best_index < len(videos):
            logging.info(f"Sub-Agent selected video index {best_index}")
            return best_index
    except Exception as e:
        logging.error(f"Error evaluating B-roll: {e}")
        
    return 0

def generate_segment_manifest(words: list, user_prompt: str = None, style_config: dict = None, global_theme: str = None):
    """Passes the transcript to GPT-4o to generate a sequence of logical visual segments."""
    logging.info("Calling GPT-4o to generate segmented logical manifest...")
    
    transcript_text = "\n".join([f"[{w['start']:.2f}-{w['end']:.2f}] {w['word']}" for w in words])
    available_styles = [k for k in style_config.keys() if k.startswith('style_')] if style_config else ['style_basic_white']
    
    system_content = (
        "You are an expert video editor and director.\n"
        "Given a chronologically ordered transcript with timestamps, group the spoken words into consecutive logical 'segments' (approx 2-6 seconds each, typically a full sentence or phrase).\n"
        "Return a JSON object with a single key 'segments' containing an array of segment objects in chronological order.\n"
        "Each segment object MUST conform to this exact structure:\n"
        "- 'start_time' (float, exactly matching the first word's start time in the segment)\n"
        "- 'end_time' (float, exactly matching the last word's end time in the segment)\n"
        "- 'text_content' (string, the exact spoken words in this segment)\n"
        "- 'caption_mode' (string, exactly either 'text_behind_subject' or 'standard'. Use 'text_behind_subject' sparingly for impactful moments or introductions. Otherwise use 'standard')\n"
        f"- 'style' (string, MUST be one of these: {', '.join(available_styles)}. Choose based on the mood of the segment)\n"
        "- 'highlighted_words' (array of strings, e.g. ['crazy', 'massive']. Pick 1-3 high-impact impactful words from the text_content to emphasize significantly, like scaling up to fill the screen or turning red. Leave empty array if no word is impactful enough)\n"
        "- 'b_roll_search_term' (string or null, a highly aesthetic generic search query if b-roll fits the feeling. Null translates to keeping the camera on the speaker.)"
    )
    
    if global_theme:
        system_content += f"\n\nCRITICAL THEMATIC DIRECTION: The global theme is '{global_theme}'. B-roll selections must strongly reflect this theme."
    
    if user_prompt:
        system_content += f"\n\nCRITICAL CREATIVE DIRECTION: '{user_prompt}'."
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            response_format={ "type": "json_object" },
            messages=[
                {
                    "role": "system",
                    "content": system_content
                },
                {"role": "user", "content": f"Transcript to segment:\n{transcript_text}"}
            ]
        )
        
        manifest = json.loads(response.choices[0].message.content)
        segments = manifest.get("segments", [])
        
        # Verify continuity and fix potentially bad LLM outputs
        if segments and words:
            segments[-1]['end_time'] = words[-1]['end'] + 0.5
            
        logging.info(f"Generated {len(segments)} narrative segments.")
        return segments
    except Exception as e:
        logging.error(f"Error calling LLM for segments: {e}")
        return []
