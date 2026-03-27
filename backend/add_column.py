import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import engine
from sqlalchemy import text

with engine.begin() as conn:
    try:
        conn.execute(text("ALTER TABLE render_jobs ADD COLUMN details JSON;"))
        print("Column 'details' added successfully.")
    except Exception as e:
        print(f"Column might already exist or error occurred: {e}")
