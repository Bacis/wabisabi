import os
import urllib.request
import logging

FONT_LINKS = {
    "inter": "https://github.com/google/fonts/raw/main/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf",    # OpenSans is a highly reliable fallback for Inter
    "roboto": "https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Regular.ttf",         # Direct Roboto repo
    "bangers": "https://github.com/google/fonts/raw/main/ofl/bangers/Bangers-Regular.ttf",
    "impact": "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf",
    "comic_sans": "https://github.com/google/fonts/raw/main/ofl/comicneue/ComicNeue-Bold.ttf",
    "arial": "https://github.com/google/fonts/raw/main/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf",
    "helvetica": "https://github.com/google/fonts/raw/main/ofl/opensans/OpenSans%5Bwdth%2Cwght%5D.ttf",
}

DEFAULT_FONT = "inter"

def get_font_path(font_family: str) -> str:
    """Returns the absolute path to a downloaded .ttf file for the given font family."""
    if not font_family:
        font_family = DEFAULT_FONT
        
    font_name = font_family.lower().replace("'", "").replace('"', '').strip()
    
    matched_key = DEFAULT_FONT
    for key in FONT_LINKS.keys():
        if key.replace('_', ' ') in font_name or key in font_name:
            matched_key = key
            break
            
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    fonts_dir = os.path.join(backend_dir, "assets", "fonts")
    os.makedirs(fonts_dir, exist_ok=True)
    
    font_path = os.path.join(fonts_dir, f"{matched_key}.ttf")
    
    if not os.path.exists(font_path):
        url = FONT_LINKS[matched_key]
        logging.info(f"Downloading font {matched_key} from {url} to {font_path}...")
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req) as response, open(font_path, 'wb') as out_file:
                out_file.write(response.read())
            logging.info("Font downloaded successfully.")
        except Exception as e:
            logging.error(f"Failed to download font: {e}")
            # Fallback to system fonts if download fails
            return "/System/Library/Fonts/HelveticaNeue.ttc"
            
    return font_path

