from fastapi import FastAPI, UploadFile, File
from app.routers import health

app = FastAPI()
app.include_router(health.router)


@app.get("/")
async def root():
    return {"message": "Backend is running"}


@app.post("/solve")
async def solve(image: UploadFile = File(...)):
    return {"solution": "Qh7#"}
