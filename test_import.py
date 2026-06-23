import sys
import traceback
try:
    from app.main import app
    print("Import successful!")
except Exception as e:
    print("Import failed!")
    traceback.print_exc()
