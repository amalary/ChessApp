from fastapi import FastAPI, UploadFile, File
from ChessApp.routers import health  

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello from ChessApp"}

@app.post("/solve")
async def solve(image: UploadFile = File(...)):
    # TODO: your chess solving logic
    return {"solution": "Qh7#"}  

