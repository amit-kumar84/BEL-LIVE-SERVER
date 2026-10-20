from __future__ import annotations

import os

import uvicorn

from app.main import app


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("CYBERNOC_HOST", "127.0.0.1"),
        port=int(os.getenv("CYBERNOC_PORT", "8000")),
        log_level="info",
    )
