from fastapi import FastAPI, UploadFile, File
from ChessApp.routers import health  # we'll fix this line in a second

app = FastAPI()

# TEMP: comment out the router line if it's breaking things,
# or fix the import to use ChessApp.routers if needed.

# app.include_router(health.router)

@app.get("/")
async def root():
    return {"message": "Hello from ChessApp"}

@app.post("/solve")
async def solve(image: UploadFile = File(...)):
    # TODO: your chess solving logic
    return {"solution": "Qh7#"}  

