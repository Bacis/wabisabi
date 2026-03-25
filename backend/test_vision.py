import asyncio
from app.services.llm_service import init_llm_service, extract_style_config
from openai import OpenAI
import os

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
init_llm_service(client)

import logging
logging.basicConfig(level=logging.INFO)

url = "https://images.unsplash.com/photo-1579546929518-9e396f3cc809"
print(extract_style_config(url))
