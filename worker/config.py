import os
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Bangkok")
ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = ROOT / "assets" / "fonts"
WORK_DIR = Path(os.getenv("WORK_DIR", ROOT / ".work"))

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
FB_GRAPH_VERSION = os.getenv("FB_GRAPH_VERSION", "v23.0")
BUCKET = "clips"

# Seconds a single tick may spend producing clips before handing over to the next tick.
PRODUCE_BUDGET_SEC = int(os.getenv("PRODUCE_BUDGET_SEC", "1200"))
MAX_ATTEMPTS = 3

# Fallbacks when a key has not been saved from the web settings page.
ENV_SECRETS = {
    "gemini_api_key": os.getenv("GEMINI_API_KEY", ""),
    "groq_api_key": os.getenv("GROQ_API_KEY", ""),
    "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
    "pexels_api_key": os.getenv("PEXELS_API_KEY", ""),
    "pixabay_api_key": os.getenv("PIXABAY_API_KEY", ""),
    "telegram_bot_token": os.getenv("TELEGRAM_BOT_TOKEN", ""),
}
