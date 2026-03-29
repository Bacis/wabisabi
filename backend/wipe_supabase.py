import os
import sys

from dotenv import load_dotenv
load_dotenv(".env")
from supabase import create_client

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")

if not supabase_url or not supabase_key:
    print("Cannot find Supabase credentials.")
    sys.exit(1)

supabase = create_client(supabase_url, supabase_key)
bucket_name = "wabisabi-assets"

try:
    print(f"Emptying bucket: {bucket_name}")
    files = supabase.storage.from_(bucket_name).list()
    if files:
        filenames = [f['name'] for f in files if f['name'] != '.emptyFolderPlaceholder']
        if filenames:
            supabase.storage.from_(bucket_name).remove(filenames)
            print(f"Successfully deleted {len(filenames)} files.")
        else:
            print("No files to delete.")
    else:
        print("Bucket is already empty.")
except Exception as e:
    print(f"Error checking/deleting bucket: {e}")
