from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI

from app.database import init_db
from app.api.routes import briefs, projects, scripts, videos, reviews


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await init_db()
    yield


app = FastAPI(
    title="ReelForge API",
    description="AI Video Service Agent System",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(briefs.router, prefix="/briefs", tags=["briefs"])
app.include_router(projects.router, prefix="/projects", tags=["projects"])
app.include_router(scripts.router, prefix="/scripts", tags=["scripts"])
app.include_router(videos.router, prefix="/videos", tags=["videos"])
app.include_router(reviews.router, prefix="/reviews", tags=["reviews"])


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "name": "ReelForge API",
        "version": "0.1.0",
        "description": "AI Video Service Agent System",
    }
